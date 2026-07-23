"""Roulette operations against real Gundu Wallet + JWT user."""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass

from django.db import transaction
from django.db.models import F, Sum

from accounts.models import Transaction as Txn, Wallet
from game.models import (
    RoulettePendingBet,
    RouletteRound,
    RouletteSettledBet,
    RouletteUndoEntry,
)
from game.roulette_rules import BetKey, parse_bet_key, settle_amount, validate_bet_key

logger = logging.getLogger("game")


class GameError(Exception):
    pass


@dataclass
class SpinResult:
    number: int
    win: int
    balance: int
    total_stake: int
    round_id: int
    winning_keys: list[str]


def _sync_redis_balance(user_id: int, balance: int) -> None:
    try:
        from game.utils import get_redis_client
        r = get_redis_client()
        if r:
            r.set(f"user_balance:{user_id}", str(balance), ex=86400)
    except Exception as exc:
        logger.warning("roulette redis balance sync failed: %s", exc)


def _wallet_balance(user) -> int:
    wallet = Wallet.objects.get(user=user)
    return int(wallet.balance)


def pending_bets_payload(user) -> list[dict]:
    return [
        {
            "key": bet.bet_key,
            "type": bet.bet_type,
            "value": bet.bet_value,
            "amount": bet.amount,
        }
        for bet in RoulettePendingBet.objects.filter(user=user)
    ]


def total_pending(user) -> int:
    return RoulettePendingBet.objects.filter(user=user).aggregate(t=Sum("amount"))["t"] or 0


def user_payload(user) -> dict:
    return {
        "balance": _wallet_balance(user),
        "pending_bets": pending_bets_payload(user),
        "total_bet": total_pending(user),
        "username": user.username,
        "user_id": user.id,
    }


@transaction.atomic
def place_bet(user, raw_key: str, amount: int):
    if amount <= 0:
        raise GameError("amount must be positive")
    key = parse_bet_key(raw_key)
    validate_bet_key(key)

    wallet = Wallet.objects.select_for_update().get(user=user)
    if wallet.balance < amount:
        raise GameError("insufficient balance")

    before = int(wallet.balance)
    wallet.balance -= amount
    wallet.save(update_fields=["balance", "updated_at"])

    bet, _ = RoulettePendingBet.objects.get_or_create(
        user=user,
        bet_type=key.bet_type,
        bet_value=key.bet_value,
        defaults={"amount": 0},
    )
    RoulettePendingBet.objects.filter(pk=bet.pk).update(amount=F("amount") + amount)
    RouletteUndoEntry.objects.create(
        user=user,
        bet_type=key.bet_type,
        bet_value=key.bet_value,
        chip=amount,
    )
    Txn.objects.create(
        user=user,
        transaction_type="BET",
        amount=-amount,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Roulette bet {key.key} ₹{amount}",
    )
    _sync_redis_balance(user.id, int(wallet.balance))
    return user


@transaction.atomic
def undo_bet(user):
    wallet = Wallet.objects.select_for_update().get(user=user)
    last = RouletteUndoEntry.objects.filter(user=user).order_by("-id").first()
    if last is None:
        raise GameError("nothing to undo")

    bet = (
        RoulettePendingBet.objects.select_for_update()
        .filter(user=user, bet_type=last.bet_type, bet_value=last.bet_value)
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

    before = int(wallet.balance)
    wallet.balance += last.chip
    wallet.save(update_fields=["balance", "updated_at"])
    Txn.objects.create(
        user=user,
        transaction_type="REFUND",
        amount=last.chip,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Roulette undo {last.bet_type} ₹{last.chip}",
    )
    last.delete()
    _sync_redis_balance(user.id, int(wallet.balance))
    return user


@transaction.atomic
def double_bets(user):
    wallet = Wallet.objects.select_for_update().get(user=user)
    bets = list(RoulettePendingBet.objects.select_for_update().filter(user=user))
    need = sum(b.amount for b in bets)
    if need <= 0:
        raise GameError("no bets to double")
    if wallet.balance < need:
        raise GameError("insufficient balance")

    before = int(wallet.balance)
    for bet in bets:
        chip = bet.amount
        bet.amount = bet.amount * 2
        bet.save(update_fields=["amount"])
        RouletteUndoEntry.objects.create(
            user=user,
            bet_type=bet.bet_type,
            bet_value=bet.bet_value,
            chip=chip,
        )
    wallet.balance -= need
    wallet.save(update_fields=["balance", "updated_at"])
    Txn.objects.create(
        user=user,
        transaction_type="BET",
        amount=-need,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Roulette double bets ₹{need}",
    )
    _sync_redis_balance(user.id, int(wallet.balance))
    return user


@transaction.atomic
def clear_bets(user):
    wallet = Wallet.objects.select_for_update().get(user=user)
    refund = total_pending(user)
    RoulettePendingBet.objects.filter(user=user).delete()
    RouletteUndoEntry.objects.filter(user=user).delete()
    if refund:
        before = int(wallet.balance)
        wallet.balance += refund
        wallet.save(update_fields=["balance", "updated_at"])
        Txn.objects.create(
            user=user,
            transaction_type="REFUND",
            amount=refund,
            balance_before=before,
            balance_after=int(wallet.balance),
            description=f"Roulette clear bets refund ₹{refund}",
        )
        _sync_redis_balance(user.id, int(wallet.balance))
    return user


@transaction.atomic
def spin(user) -> SpinResult:
    wallet = Wallet.objects.select_for_update().get(user=user)
    bets = list(RoulettePendingBet.objects.select_for_update().filter(user=user))
    if not bets:
        raise GameError("place at least one bet before spinning")

    number = secrets.randbelow(37)
    total_stake = sum(b.amount for b in bets)
    win = 0
    winning_keys: list[str] = []
    settled_rows: list[RouletteSettledBet] = []

    round_obj = RouletteRound.objects.create(
        user=user,
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
            RouletteSettledBet(
                round=round_obj,
                bet_type=bet.bet_type,
                bet_value=bet.bet_value,
                amount=bet.amount,
                won=won,
                payout=payout,
            )
        )

    RouletteSettledBet.objects.bulk_create(settled_rows)
    round_obj.total_payout = win
    round_obj.save(update_fields=["total_payout"])

    RoulettePendingBet.objects.filter(user=user).delete()
    RouletteUndoEntry.objects.filter(user=user).delete()

    if win:
        before = int(wallet.balance)
        wallet.balance += win
        wallet.save(update_fields=["balance", "updated_at"])
        Txn.objects.create(
            user=user,
            transaction_type="WIN",
            amount=win,
            balance_before=before,
            balance_after=int(wallet.balance),
            description=f"Roulette WIN number={number} payout ₹{win}",
        )
        _sync_redis_balance(user.id, int(wallet.balance))

    return SpinResult(
        number=number,
        win=win,
        balance=int(wallet.balance),
        total_stake=total_stake,
        round_id=round_obj.pk,
        winning_keys=winning_keys,
    )


def history(user, limit: int = 20) -> list[dict]:
    limit = max(1, min(limit, 100))
    rounds = RouletteRound.objects.filter(user=user)[:limit]
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
