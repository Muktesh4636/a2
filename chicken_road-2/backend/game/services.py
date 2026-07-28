"""Server-authoritative Chicken Road round logic."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from .constants import (
    HIT_CHANCE,
    MAX_BET,
    MAX_WIN,
    MIN_BET,
    MULTIPLIERS,
    START_BALANCE,
)
from .models import LedgerEntry, Player, Round

TWOPLACES = Decimal("0.01")


class GameError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def multipliers_for(difficulty: str) -> list[float]:
    try:
        return MULTIPLIERS[difficulty]
    except KeyError as exc:
        raise GameError("Invalid difficulty") from exc


def potential_payout(bet: Decimal, difficulty: str, step: int) -> Decimal:
    if step <= 0:
        return money(0)
    mults = multipliers_for(difficulty)
    if step > len(mults):
        raise GameError("Invalid step")
    raw = money(bet) * Decimal(str(mults[step - 1]))
    capped = min(raw, money(MAX_WIN))
    return money(capped)


def roll_crash(difficulty: str, server_seed: str, client_seed: str) -> int | None:
    """Deterministic crash step from seeds (provably fair)."""
    p = HIT_CHANCE[difficulty]
    n = len(multipliers_for(difficulty))
    for step in range(1, n + 1):
        digest = hmac.new(
            server_seed.encode(),
            f"{client_seed}:{step}".encode(),
            hashlib.sha256,
        ).hexdigest()
        roll = int(digest[:8], 16) / 0xFFFFFFFF
        if roll < p:
            return step
    return None


def _ledger(player: Player, kind: str, amount: Decimal, round_obj=None, note: str = ""):
    LedgerEntry.objects.create(
        player=player,
        round=round_obj,
        kind=kind,
        amount=amount,
        balance_after=player.balance,
        note=note,
    )


def get_or_create_player(token: str | None) -> Player:
    if token:
        player = Player.objects.filter(token=token).first()
        if player:
            return player
    return Player.create_guest()


@transaction.atomic
def reset_balance(player: Player) -> Player:
    player = Player.objects.select_for_update().get(pk=player.pk)
    Round.objects.filter(player=player, status=Round.Status.ACTIVE).update(
        status=Round.Status.CRASHED,
        finished_at=timezone.now(),
        payout=0,
    )
    player.balance = money(START_BALANCE)
    player.save(update_fields=["balance", "updated_at"])
    _ledger(player, LedgerEntry.Kind.RESET, money(START_BALANCE), note="Balance reset")
    return player


@transaction.atomic
def start_round(
    player: Player,
    bet,
    difficulty: str,
    client_seed: str = "",
) -> Round:
    if difficulty not in MULTIPLIERS:
        raise GameError("Invalid difficulty")

    bet = money(bet)
    if bet < money(MIN_BET) or bet > money(MAX_BET):
        raise GameError(f"Bet must be between {MIN_BET} and {MAX_BET}")

    player = Player.objects.select_for_update().get(pk=player.pk)

    if Round.objects.filter(player=player, status=Round.Status.ACTIVE).exists():
        raise GameError("You already have an active round")

    if player.balance < bet:
        raise GameError("Insufficient balance")

    server_seed = secrets.token_hex(32)
    client_seed = (client_seed or secrets.token_hex(16))[:64]
    server_seed_hash = hashlib.sha256(server_seed.encode()).hexdigest()
    crash_at = roll_crash(difficulty, server_seed, client_seed)

    player.balance = money(player.balance - bet)
    player.save(update_fields=["balance", "updated_at"])

    round_obj = Round.objects.create(
        player=player,
        difficulty=difficulty,
        bet=bet,
        step=0,
        crash_at=crash_at,
        status=Round.Status.ACTIVE,
        server_seed=server_seed,
        server_seed_hash=server_seed_hash,
        client_seed=client_seed,
    )
    _ledger(player, LedgerEntry.Kind.BET, -bet, round_obj, note="Round started")
    return round_obj


def _reveal(round_obj: Round) -> dict:
    return {
        "server_seed": round_obj.server_seed,
        "server_seed_hash": round_obj.server_seed_hash,
        "client_seed": round_obj.client_seed,
        "crash_at": round_obj.crash_at,
    }


def public_round(round_obj: Round, *, reveal: bool = False) -> dict:
    data = {
        "id": str(round_obj.id),
        "difficulty": round_obj.difficulty,
        "bet": str(round_obj.bet),
        "step": round_obj.step,
        "status": round_obj.status,
        "payout": str(round_obj.payout),
        "server_seed_hash": round_obj.server_seed_hash,
        "client_seed": round_obj.client_seed,
        "potential": str(
            potential_payout(round_obj.bet, round_obj.difficulty, round_obj.step)
        ),
        "created_at": round_obj.created_at.isoformat(),
        "finished_at": round_obj.finished_at.isoformat() if round_obj.finished_at else None,
    }
    if reveal or round_obj.status != Round.Status.ACTIVE:
        data["reveal"] = _reveal(round_obj)
    return data


@transaction.atomic
def step_round(player: Player, round_id) -> dict:
    player = Player.objects.select_for_update().get(pk=player.pk)
    try:
        round_obj = Round.objects.select_for_update().get(pk=round_id, player=player)
    except Round.DoesNotExist as exc:
        raise GameError("Round not found", status=404) from exc

    if round_obj.status != Round.Status.ACTIVE:
        raise GameError("Round is not active")

    next_step = round_obj.step + 1
    total = len(multipliers_for(round_obj.difficulty))
    if next_step > total:
        raise GameError("No more steps")

    if round_obj.crash_at is not None and next_step == round_obj.crash_at:
        round_obj.step = next_step
        round_obj.status = Round.Status.CRASHED
        round_obj.payout = money(0)
        round_obj.finished_at = timezone.now()
        round_obj.save(update_fields=["step", "status", "payout", "finished_at"])
        _ledger(player, LedgerEntry.Kind.LOSS, money(0), round_obj, note="Crashed")
        return {
            "round": round_obj,
            "survived": False,
            "crashed": True,
            "completed": False,
            "step": next_step,
            "multiplier": multipliers_for(round_obj.difficulty)[next_step - 1],
            "potential": money(0),
            "balance": player.balance,
            "reveal": _reveal(round_obj),
        }

    round_obj.step = next_step
    pot = potential_payout(round_obj.bet, round_obj.difficulty, next_step)

    if next_step >= total:
        player.balance = money(player.balance + pot)
        player.save(update_fields=["balance", "updated_at"])
        round_obj.status = Round.Status.COMPLETED
        round_obj.payout = pot
        round_obj.finished_at = timezone.now()
        round_obj.save(update_fields=["step", "status", "payout", "finished_at"])
        _ledger(player, LedgerEntry.Kind.WIN, pot, round_obj, note="Finished road")
        return {
            "round": round_obj,
            "survived": True,
            "crashed": False,
            "completed": True,
            "step": next_step,
            "multiplier": multipliers_for(round_obj.difficulty)[next_step - 1],
            "potential": pot,
            "payout": pot,
            "balance": player.balance,
            "reveal": _reveal(round_obj),
        }

    round_obj.save(update_fields=["step"])
    return {
        "round": round_obj,
        "survived": True,
        "crashed": False,
        "completed": False,
        "step": next_step,
        "multiplier": multipliers_for(round_obj.difficulty)[next_step - 1],
        "potential": pot,
        "balance": player.balance,
    }


@transaction.atomic
def cash_out(player: Player, round_id) -> dict:
    player = Player.objects.select_for_update().get(pk=player.pk)
    try:
        round_obj = Round.objects.select_for_update().get(pk=round_id, player=player)
    except Round.DoesNotExist as exc:
        raise GameError("Round not found", status=404) from exc

    if round_obj.status != Round.Status.ACTIVE:
        raise GameError("Round is not active")
    if round_obj.step <= 0:
        raise GameError("Nothing to cash out yet")

    pot = potential_payout(round_obj.bet, round_obj.difficulty, round_obj.step)
    player.balance = money(player.balance + pot)
    player.save(update_fields=["balance", "updated_at"])

    round_obj.status = Round.Status.CASHED_OUT
    round_obj.payout = pot
    round_obj.finished_at = timezone.now()
    round_obj.save(update_fields=["status", "payout", "finished_at"])
    _ledger(player, LedgerEntry.Kind.WIN, pot, round_obj, note="Cash out")

    return {
        "round": round_obj,
        "payout": pot,
        "balance": player.balance,
        "reveal": _reveal(round_obj),
    }
