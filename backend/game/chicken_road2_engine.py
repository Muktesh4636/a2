"""Chicken Road 2 — server-authoritative engine using Gundu Wallet (integer ₹)."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

MULTIPLIERS = {
    "easy": [
        1.01, 1.03, 1.06, 1.1, 1.15, 1.19, 1.24, 1.3, 1.35, 1.42, 1.48, 1.56, 1.65,
        1.75, 1.85, 1.98, 2.12, 2.28, 2.47, 2.7, 2.96, 3.28, 3.7, 4.11, 4.64, 5.39,
        6.5, 8.36, 12.08, 23.24,
    ],
    "medium": [
        1.08, 1.21, 1.37, 1.56, 1.78, 2.05, 2.37, 2.77, 3.24, 3.85, 4.62, 5.61, 6.91,
        8.64, 10.99, 14.29, 18.96, 26.07, 37.24, 53.82, 82.36, 137.59, 265.35,
        638.82, 2457.0,
    ],
    "hard": [
        1.18, 1.46, 1.83, 2.31, 2.95, 3.82, 5.02, 6.66, 9.04, 12.52, 17.74, 25.8,
        38.71, 60.21, 97.34, 166.87, 305.94, 595.86, 1283.03, 3267.64, 10898.54,
        62162.09,
    ],
    "hardcore": [
        1.44, 2.21, 3.45, 5.53, 9.09, 15.3, 26.78, 48.7, 92.54, 185.08, 391.25,
        894.28, 2235.72, 6096.15, 18960.33, 72432.75, 379632.82, 3608855.25,
    ],
}

HIT_CHANCE = {
    "easy": 1 / 25,
    "medium": 3 / 25,
    "hard": 5 / 25,
    "hardcore": 10 / 25,
}

DIFFICULTIES = {
    "easy": {"label": "Easy", "heat": 1, "tag": "Cool"},
    "medium": {"label": "Medium", "heat": 2, "tag": "Hot"},
    "hard": {"label": "Hard", "heat": 3, "tag": "Hotter"},
    "hardcore": {"label": "Hardcore", "heat": 4, "tag": "Extreme"},
}

MIN_BET = 10
MAX_BET = 500
MAX_WIN = 20000


class GameError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def money_rupees(value) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def multipliers_for(difficulty: str) -> list[float]:
    try:
        return MULTIPLIERS[difficulty]
    except KeyError as exc:
        raise GameError("Invalid difficulty") from exc


def potential_payout(bet: int, difficulty: str, step: int) -> int:
    if step <= 0:
        return 0
    mults = multipliers_for(difficulty)
    if step > len(mults):
        raise GameError("Invalid step")
    raw = money_rupees(bet * Decimal(str(mults[step - 1])))
    return min(raw, MAX_WIN)


def roll_crash(difficulty: str, server_seed: str, client_seed: str) -> int | None:
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


def game_config() -> dict:
    return {
        "min_bet": MIN_BET,
        "max_bet": MAX_BET,
        "max_win": MAX_WIN,
        "difficulties": {
            key: {
                **meta,
                "hit_chance": HIT_CHANCE[key],
                "multipliers": MULTIPLIERS[key],
                "steps": len(MULTIPLIERS[key]),
            }
            for key, meta in DIFFICULTIES.items()
        },
    }


def public_round(round_obj, *, reveal: bool = False) -> dict:
    data = {
        "id": str(round_obj.id),
        "difficulty": round_obj.difficulty,
        "bet": int(round_obj.bet),
        "step": int(round_obj.step),
        "status": round_obj.status,
        "payout": int(round_obj.payout),
        "server_seed_hash": round_obj.server_seed_hash,
        "client_seed": round_obj.client_seed,
        "potential": potential_payout(int(round_obj.bet), round_obj.difficulty, int(round_obj.step)),
        "created_at": round_obj.created_at.isoformat(),
        "finished_at": round_obj.finished_at.isoformat() if round_obj.finished_at else None,
    }
    if reveal or round_obj.status != round_obj.Status.ACTIVE:
        data["reveal"] = {
            "server_seed": round_obj.server_seed,
            "server_seed_hash": round_obj.server_seed_hash,
            "client_seed": round_obj.client_seed,
            "crash_at": round_obj.crash_at,
        }
    return data


@transaction.atomic
def start_round(user, bet, difficulty: str, client_seed: str = ""):
    from game.models import ChickenRoad2Round

    Wallet, Txn = _wallet_ops()
    if difficulty not in MULTIPLIERS:
        raise GameError("Invalid difficulty")
    bet = money_rupees(bet)
    if bet < MIN_BET or bet > MAX_BET:
        raise GameError(f"Bet must be between {MIN_BET} and {MAX_BET}")

    wallet = Wallet.objects.select_for_update().get(user=user)
    # Abandon any stuck ACTIVE round so Play always starts a fresh run
    stuck = list(
        ChickenRoad2Round.objects.select_for_update().filter(
            user=user, status=ChickenRoad2Round.Status.ACTIVE
        )
    )
    now = timezone.now()
    for old in stuck:
        old.status = ChickenRoad2Round.Status.CRASHED
        old.payout = 0
        old.finished_at = now
        old.save(update_fields=["status", "payout", "finished_at", "updated_at"])

    if int(wallet.balance) < bet:
        raise GameError("Insufficient balance")

    server_seed = secrets.token_hex(32)
    client_seed = (client_seed or secrets.token_hex(16))[:64]
    server_seed_hash = hashlib.sha256(server_seed.encode()).hexdigest()
    crash_at = roll_crash(difficulty, server_seed, client_seed)

    before = int(wallet.balance)
    wallet.balance = before - bet
    wallet.save(update_fields=["balance", "updated_at"])
    Txn.objects.create(
        user=user,
        transaction_type="BET",
        amount=bet,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Chicken Road 2 bet ₹{bet} ({difficulty})",
    )
    _sync_redis_balance(user.id, int(wallet.balance))

    round_obj = ChickenRoad2Round.objects.create(
        user=user,
        difficulty=difficulty,
        bet=bet,
        step=0,
        crash_at=crash_at,
        status=ChickenRoad2Round.Status.ACTIVE,
        server_seed=server_seed,
        server_seed_hash=server_seed_hash,
        client_seed=client_seed,
        payout=0,
    )
    return {
        "balance": int(wallet.balance),
        "round": public_round(round_obj),
    }


@transaction.atomic
def step_round(user, round_id) -> dict:
    from game.models import ChickenRoad2Round

    Wallet, Txn = _wallet_ops()
    wallet = Wallet.objects.select_for_update().get(user=user)
    round_obj = (
        ChickenRoad2Round.objects.select_for_update()
        .filter(pk=round_id, user=user)
        .first()
    )
    if not round_obj:
        raise GameError("Round not found", status=404)
    if round_obj.status != ChickenRoad2Round.Status.ACTIVE:
        raise GameError("Round is not active")

    next_step = round_obj.step + 1
    total = len(multipliers_for(round_obj.difficulty))
    if next_step > total:
        raise GameError("No more steps")

    mult = multipliers_for(round_obj.difficulty)[next_step - 1]

    if round_obj.crash_at is not None and next_step == round_obj.crash_at:
        round_obj.step = next_step
        round_obj.status = ChickenRoad2Round.Status.CRASHED
        round_obj.payout = 0
        round_obj.finished_at = timezone.now()
        round_obj.save(update_fields=["step", "status", "payout", "finished_at", "updated_at"])
        return {
            "balance": int(wallet.balance),
            "survived": False,
            "crashed": True,
            "completed": False,
            "step": next_step,
            "multiplier": mult,
            "potential": 0,
            "round": public_round(round_obj, reveal=True),
        }

    round_obj.step = next_step
    pot = potential_payout(int(round_obj.bet), round_obj.difficulty, next_step)

    if next_step >= total:
        before = int(wallet.balance)
        wallet.balance = before + pot
        wallet.save(update_fields=["balance", "updated_at"])
        Txn.objects.create(
            user=user,
            transaction_type="WIN",
            amount=pot,
            balance_before=before,
            balance_after=int(wallet.balance),
            description=f"Chicken Road 2 finished ₹{pot}",
        )
        _sync_redis_balance(user.id, int(wallet.balance))
        round_obj.status = ChickenRoad2Round.Status.COMPLETED
        round_obj.payout = pot
        round_obj.finished_at = timezone.now()
        round_obj.save(update_fields=["step", "status", "payout", "finished_at", "updated_at"])
        return {
            "balance": int(wallet.balance),
            "survived": True,
            "crashed": False,
            "completed": True,
            "step": next_step,
            "multiplier": mult,
            "potential": pot,
            "payout": pot,
            "round": public_round(round_obj, reveal=True),
        }

    round_obj.save(update_fields=["step", "updated_at"])
    return {
        "balance": int(wallet.balance),
        "survived": True,
        "crashed": False,
        "completed": False,
        "step": next_step,
        "multiplier": mult,
        "potential": pot,
        "round": public_round(round_obj),
    }


@transaction.atomic
def cash_out(user, round_id) -> dict:
    from game.models import ChickenRoad2Round

    Wallet, Txn = _wallet_ops()
    wallet = Wallet.objects.select_for_update().get(user=user)
    round_obj = (
        ChickenRoad2Round.objects.select_for_update()
        .filter(pk=round_id, user=user)
        .first()
    )
    if not round_obj:
        raise GameError("Round not found", status=404)
    if round_obj.status != ChickenRoad2Round.Status.ACTIVE:
        raise GameError("Round is not active")
    if round_obj.step <= 0:
        raise GameError("Nothing to cash out yet")

    pot = potential_payout(int(round_obj.bet), round_obj.difficulty, int(round_obj.step))
    before = int(wallet.balance)
    wallet.balance = before + pot
    wallet.save(update_fields=["balance", "updated_at"])
    Txn.objects.create(
        user=user,
        transaction_type="WIN",
        amount=pot,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Chicken Road 2 cashout ₹{pot}",
    )
    _sync_redis_balance(user.id, int(wallet.balance))

    round_obj.status = ChickenRoad2Round.Status.CASHED_OUT
    round_obj.payout = pot
    round_obj.finished_at = timezone.now()
    round_obj.save(update_fields=["status", "payout", "finished_at", "updated_at"])

    return {
        "balance": int(wallet.balance),
        "payout": pot,
        "round": public_round(round_obj, reveal=True),
    }


@transaction.atomic
def forfeit_round(user, round_id) -> dict:
    """Mark an active round crashed (client collision / abandon). No payout."""
    from game.models import ChickenRoad2Round

    Wallet, _Txn = _wallet_ops()
    wallet = Wallet.objects.select_for_update().get(user=user)
    round_obj = (
        ChickenRoad2Round.objects.select_for_update()
        .filter(pk=round_id, user=user)
        .first()
    )
    if not round_obj:
        raise GameError("Round not found", status=404)
    if round_obj.status != ChickenRoad2Round.Status.ACTIVE:
        return {
            "balance": int(wallet.balance),
            "round": public_round(round_obj, reveal=True),
        }
    round_obj.status = ChickenRoad2Round.Status.CRASHED
    round_obj.payout = 0
    round_obj.finished_at = timezone.now()
    round_obj.save(update_fields=["status", "payout", "finished_at", "updated_at"])
    return {
        "balance": int(wallet.balance),
        "crashed": True,
        "round": public_round(round_obj, reveal=True),
    }


def active_round_for(user):
    from game.models import ChickenRoad2Round

    return (
        ChickenRoad2Round.objects.filter(user=user, status=ChickenRoad2Round.Status.ACTIVE)
        .order_by("-created_at")
        .first()
    )
