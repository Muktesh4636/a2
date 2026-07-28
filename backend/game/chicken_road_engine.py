"""Chicken Road (v1) — server-authoritative engine using Gundu Wallet (integer ₹)."""

from __future__ import annotations

import random
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.db import transaction

TOTAL = 24
MIN_BET = 10
MAX_BET = 500

MULTS: dict[str, list[float]] = {
    "easy": [
        1.03, 1.07, 1.12, 1.17, 1.23, 1.29, 1.36, 1.44, 1.52, 1.61, 1.71, 1.81,
        1.92, 2.04, 2.17, 2.30, 2.45, 2.60, 2.76, 2.94, 3.12, 3.32, 3.53, 3.75,
    ],
    "medium": [
        1.12, 1.28, 1.47, 1.70, 1.98, 2.31, 2.70, 3.16, 3.70, 4.34, 5.10, 6.00,
        7.07, 8.34, 9.85, 11.64, 13.77, 16.30, 19.30, 22.85, 27.07, 32.08, 38.02, 45.08,
    ],
    "hard": [
        1.23, 1.55, 1.98, 2.56, 3.36, 4.45, 5.95, 8.03, 10.92, 14.97, 20.66, 28.70,
        40.12, 56.40, 79.80, 113.4, 161.8, 231.6, 332.8, 480.0, 694.5, 1008, 1468, 2144,
    ],
    "hardcore": [
        1.63, 2.80, 5.00, 9.31, 18.0, 36.1, 74.5, 157, 339, 748, 1690, 3910,
        9280, 22600, 56500, 145000, 382000, 1035000, 2880000, 8230000,
        24100000, 72500000, 224000000, 710000000,
    ],
}

FIRE_P = {"easy": 0.12, "medium": 0.2, "hard": 0.35, "hardcore": 0.5}
DIFFICULTIES = tuple(MULTS.keys())


class GameError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def money_rupees(value) -> int:
    """Round to nearest integer rupee for Wallet.BigIntegerField."""
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def build_road(difficulty: str) -> list[dict[str, Any]]:
    if difficulty not in MULTS:
        raise GameError(f"Invalid difficulty: {difficulty}")
    m = MULTS[difficulty]
    p = FIRE_P[difficulty]
    road = []
    for i in range(TOTAL):
        fire_chance = min(0.85, p * (1 + i * 0.08))
        road.append({
            "safe": random.random() >= fire_chance,
            "mult": m[i] if i < len(m) else m[-1],
            "revealed": False,
        })
    return road


def revealed_tiles(road: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for i, tile in enumerate(road):
        if tile.get("revealed"):
            out.append({"index": i, "safe": bool(tile["safe"]), "mult": float(tile["mult"])})
    return out


def current_mult(road: list[dict[str, Any]], step: int) -> float:
    if step <= 0:
        return 1.0
    return float(road[step - 1]["mult"])


def _wallet_ops():
    from accounts.models import Transaction as Txn, Wallet
    return Wallet, Txn


def _sync_redis_balance(user_id: int, balance: int) -> None:
    try:
        from game.utils import get_redis_client
        r = get_redis_client()
        if r:
            r.set(f"user_balance:{user_id}", str(balance), ex=86400)
    except Exception:
        pass


def public_state(round_obj, balance: int | None = None) -> dict[str, Any]:
    road = list(round_obj.road_secret or [])
    step = int(round_obj.step)
    bet = int(round_obj.bet)
    mult = current_mult(road, step)
    cashout_amount = money_rupees(bet * mult) if step > 0 else 0
    burned = round_obj.status == round_obj.Status.BURNED
    payload = {
        "round_id": str(round_obj.id),
        "status": round_obj.status,
        "step": step,
        "bet": bet,
        "difficulty": round_obj.difficulty,
        "current_mult": mult,
        "cashout_amount": cashout_amount,
        "payout": int(round_obj.payout),
        "revealed": revealed_tiles(road),
        "burned": burned,
        "total_steps": TOTAL,
    }
    if balance is not None:
        payload["balance"] = int(balance)
    return payload


def game_config() -> dict[str, Any]:
    return {
        "min_bet": MIN_BET,
        "max_bet": MAX_BET,
        "total_steps": TOTAL,
        "difficulties": list(DIFFICULTIES),
        "multipliers": {k: list(v) for k, v in MULTS.items()},
    }


@transaction.atomic
def start_round(user, bet, difficulty: str):
    from game.models import ChickenRoadRound

    Wallet, Txn = _wallet_ops()
    if difficulty not in DIFFICULTIES:
        raise GameError("Invalid difficulty")
    bet = money_rupees(bet)
    if bet < MIN_BET or bet > MAX_BET:
        raise GameError(f"Bet must be between {MIN_BET} and {MAX_BET}")

    wallet = Wallet.objects.select_for_update().get(user=user)
    if bet > int(wallet.balance):
        raise GameError("Insufficient balance")

    ChickenRoadRound.objects.filter(user=user, status=ChickenRoadRound.Status.PLAYING).update(
        status=ChickenRoadRound.Status.BURNED,
    )

    before = int(wallet.balance)
    wallet.balance = before - bet
    wallet.save(update_fields=["balance", "updated_at"])
    Txn.objects.create(
        user=user,
        transaction_type="BET",
        amount=bet,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Chicken Road bet ₹{bet} ({difficulty})",
    )
    _sync_redis_balance(user.id, int(wallet.balance))

    round_obj = ChickenRoadRound.objects.create(
        user=user,
        difficulty=difficulty,
        bet=bet,
        status=ChickenRoadRound.Status.PLAYING,
        step=0,
        road_secret=build_road(difficulty),
        payout=0,
    )
    return apply_go(round_obj.id, user)


@transaction.atomic
def apply_go(round_id, user):
    from game.models import ChickenRoadRound

    Wallet, Txn = _wallet_ops()
    locked = (
        ChickenRoadRound.objects.select_for_update()
        .filter(pk=round_id, user=user)
        .first()
    )
    if not locked:
        raise GameError("Round not found", status=404)
    if locked.status != ChickenRoadRound.Status.PLAYING:
        raise GameError("Round is not active")

    road = list(locked.road_secret)
    index = int(locked.step)
    if index >= TOTAL or index >= len(road):
        raise GameError("No more steps")

    tile = dict(road[index])
    tile["revealed"] = True
    road[index] = tile
    next_step = index + 1
    locked.step = next_step
    locked.road_secret = road

    wallet = Wallet.objects.select_for_update().get(user=user)

    if not tile["safe"]:
        locked.status = ChickenRoadRound.Status.BURNED
        locked.payout = 0
        locked.save(update_fields=["step", "road_secret", "status", "payout", "updated_at"])
        return public_state(locked, balance=int(wallet.balance))

    if next_step >= TOTAL:
        payout = money_rupees(locked.bet * float(tile["mult"]))
        locked.status = ChickenRoadRound.Status.WON
        locked.payout = payout
        locked.save(update_fields=["step", "road_secret", "status", "payout", "updated_at"])
        before = int(wallet.balance)
        wallet.balance = before + payout
        wallet.save(update_fields=["balance", "updated_at"])
        Txn.objects.create(
            user=user,
            transaction_type="WIN",
            amount=payout,
            balance_before=before,
            balance_after=int(wallet.balance),
            description=f"Chicken Road win ₹{payout}",
        )
        _sync_redis_balance(user.id, int(wallet.balance))
        state = public_state(locked, balance=int(wallet.balance))
        state["result"] = {
            "won": True,
            "total": payout,
            "net": payout - int(locked.bet),
            "mult": float(tile["mult"]),
        }
        return state

    locked.save(update_fields=["step", "road_secret", "updated_at"])
    return public_state(locked, balance=int(wallet.balance))


@transaction.atomic
def apply_cashout(round_id, user):
    from game.models import ChickenRoadRound

    Wallet, Txn = _wallet_ops()
    locked = (
        ChickenRoadRound.objects.select_for_update()
        .filter(pk=round_id, user=user)
        .first()
    )
    if not locked:
        raise GameError("Round not found", status=404)
    if locked.status != ChickenRoadRound.Status.PLAYING:
        raise GameError("Round is not active")
    if locked.step <= 0:
        raise GameError("Cannot cash out before first step")

    road = list(locked.road_secret)
    mult = current_mult(road, locked.step)
    payout = money_rupees(locked.bet * mult)

    wallet = Wallet.objects.select_for_update().get(user=user)
    locked.status = ChickenRoadRound.Status.CASHED_OUT
    locked.payout = payout
    locked.save(update_fields=["status", "payout", "updated_at"])

    before = int(wallet.balance)
    wallet.balance = before + payout
    wallet.save(update_fields=["balance", "updated_at"])
    Txn.objects.create(
        user=user,
        transaction_type="WIN",
        amount=payout,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Chicken Road cashout ₹{payout}",
    )
    _sync_redis_balance(user.id, int(wallet.balance))

    state = public_state(locked, balance=int(wallet.balance))
    state["result"] = {
        "won": True,
        "total": payout,
        "net": payout - int(locked.bet),
        "mult": mult,
    }
    return state


def active_round_for(user):
    from game.models import ChickenRoadRound

    return (
        ChickenRoadRound.objects.filter(user=user, status=ChickenRoadRound.Status.PLAYING)
        .order_by("-created_at")
        .first()
    )
