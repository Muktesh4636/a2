"""Game operations: place / undo / double / clear / spin."""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction
from django.db.models import F, Sum

from accounts.models import Player
from game.models import PendingBet, Round, SettledBet, UndoEntry
from game.rules import BetKey, parse_bet_key, settle_amount, validate_bet_key


class GameError(Exception):
    """Domain error returned to the API layer."""


@dataclass
class SpinResult:
    number: int
    win: int
    balance: int
    total_stake: int
    round_id: int
    winning_keys: list[str]


def create_player() -> Player:
    return Player.objects.create(balance=settings.STARTING_BALANCE)


def get_player(session_token: str) -> Player:
    try:
        return Player.objects.get(session_key=session_token)
    except (Player.DoesNotExist, ValueError) as exc:
        raise GameError("invalid session token") from exc


def pending_bets_payload(player: Player) -> list[dict]:
    return [
        {
            "key": bet.bet_key,
            "type": bet.bet_type,
            "value": bet.bet_value,
            "amount": bet.amount,
        }
        for bet in player.pending_bets.all()
    ]


def total_pending(player: Player) -> int:
    return player.pending_bets.aggregate(t=Sum("amount"))["t"] or 0


@transaction.atomic
def place_bet(player: Player, raw_key: str, amount: int) -> Player:
    if amount <= 0:
        raise GameError("amount must be positive")
    key = parse_bet_key(raw_key)
    validate_bet_key(key)

    player = Player.objects.select_for_update().get(pk=player.pk)
    if player.balance < amount:
        raise GameError("insufficient balance")

    bet, _created = PendingBet.objects.get_or_create(
        player=player,
        bet_type=key.bet_type,
        bet_value=key.bet_value,
        defaults={"amount": 0},
    )
    PendingBet.objects.filter(pk=bet.pk).update(amount=F("amount") + amount)
    Player.objects.filter(pk=player.pk).update(balance=F("balance") - amount)
    UndoEntry.objects.create(
        player=player,
        bet_type=key.bet_type,
        bet_value=key.bet_value,
        chip=amount,
        visual_chip=amount,
    )
    player.refresh_from_db()
    return player


@transaction.atomic
def undo_bet(player: Player) -> Player:
    player = Player.objects.select_for_update().get(pk=player.pk)
    last = player.undo_stack.order_by("-id").first()
    if last is None:
        raise GameError("nothing to undo")

    bet = (
        PendingBet.objects.select_for_update()
        .filter(player=player, bet_type=last.bet_type, bet_value=last.bet_value)
        .first()
    )
    if bet is None:
        last.delete()
        raise GameError("pending bet missing")

    next_amount = bet.amount - last.chip
    if next_amount <= 0:
        bet.delete()
    else:
        bet.amount = next_amount
        bet.save(update_fields=["amount"])

    Player.objects.filter(pk=player.pk).update(balance=F("balance") + last.chip)
    last.delete()
    player.refresh_from_db()
    return player


@transaction.atomic
def double_bets(player: Player) -> Player:
    player = Player.objects.select_for_update().get(pk=player.pk)
    bets = list(PendingBet.objects.select_for_update().filter(player=player))
    need = sum(b.amount for b in bets)
    if need <= 0:
        raise GameError("no bets to double")
    if player.balance < need:
        raise GameError("insufficient balance")

    for bet in bets:
        chip = bet.amount
        bet.amount = bet.amount * 2
        bet.save(update_fields=["amount"])
        UndoEntry.objects.create(
            player=player,
            bet_type=bet.bet_type,
            bet_value=bet.bet_value,
            chip=chip,
            visual_chip=chip,
        )
    Player.objects.filter(pk=player.pk).update(balance=F("balance") - need)
    player.refresh_from_db()
    return player


@transaction.atomic
def clear_bets(player: Player) -> Player:
    player = Player.objects.select_for_update().get(pk=player.pk)
    refund = total_pending(player)
    PendingBet.objects.filter(player=player).delete()
    UndoEntry.objects.filter(player=player).delete()
    if refund:
        Player.objects.filter(pk=player.pk).update(balance=F("balance") + refund)
    player.refresh_from_db()
    return player


@transaction.atomic
def spin(player: Player, forced_number: int | None = None) -> SpinResult:
    player = Player.objects.select_for_update().get(pk=player.pk)
    bets = list(PendingBet.objects.select_for_update().filter(player=player))
    if not bets:
        raise GameError("place at least one bet before spinning")

    if forced_number is not None:
        if not (0 <= forced_number <= 36):
            raise GameError("number must be 0–36")
        number = forced_number
    else:
        number = secrets.randbelow(37)

    total_stake = sum(b.amount for b in bets)
    win = 0
    winning_keys: list[str] = []
    settled_rows: list[SettledBet] = []

    round_obj = Round.objects.create(
        player=player,
        winning_number=number,
        total_stake=total_stake,
        total_payout=0,
    )

    for bet in bets:
        key = BetKey(bet_type=bet.bet_type, bet_value=bet.bet_value)
        payout = settle_amount(key, bet.amount, number)
        won = payout > 0
        if won:
            win += payout
            winning_keys.append(key.key)
        settled_rows.append(
            SettledBet(
                round=round_obj,
                bet_type=bet.bet_type,
                bet_value=bet.bet_value,
                amount=bet.amount,
                won=won,
                payout=payout,
            )
        )

    SettledBet.objects.bulk_create(settled_rows)
    round_obj.total_payout = win
    round_obj.save(update_fields=["total_payout"])

    PendingBet.objects.filter(player=player).delete()
    UndoEntry.objects.filter(player=player).delete()
    Player.objects.filter(pk=player.pk).update(balance=F("balance") + win)
    player.refresh_from_db()

    return SpinResult(
        number=number,
        win=win,
        balance=player.balance,
        total_stake=total_stake,
        round_id=round_obj.pk,
        winning_keys=winning_keys,
    )


def history(player: Player, limit: int = 20) -> list[dict]:
    limit = max(1, min(limit, 100))
    rounds = player.rounds.all()[:limit]
    return [
        {
            "id": r.id,
            "number": r.winning_number,
            "stake": r.total_stake,
            "payout": r.total_payout,
            "created_at": r.created_at.isoformat(),
        }
        for r in rounds
    ]
