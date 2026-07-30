"""Vortex — server-authoritative engine using Gundu Wallet (integer ₹)."""

from __future__ import annotations

from decimal import Decimal

from django.db import transaction

from game import vortex_logic as logic

MIN_BET = 10
MAX_BET = 500
DEFAULT_BET = 10


class GameError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


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


def _fill_of(session) -> dict:
    return {"water": session.water, "earth": session.earth, "fire": session.fire}


def _set_fill(session, fill: dict) -> None:
    session.water = fill["water"]
    session.earth = fill["earth"]
    session.fire = fill["fire"]


def ensure_session(user):
    from game.models import VortexSession

    session, _ = VortexSession.objects.get_or_create(
        user=user,
        defaults={"bet": DEFAULT_BET},
    )
    return session


def snapshot(session, balance: int, **kwargs) -> dict:
    return logic.session_snapshot(session, balance, **kwargs)


@transaction.atomic
def get_state(user) -> dict:
    Wallet, _Txn = _wallet_ops()
    wallet = Wallet.objects.select_for_update().get(user=user)
    session = ensure_session(user)
    if session.busy:
        session.busy = False
        session.save(update_fields=["busy", "updated_at"])
    return snapshot(session, int(wallet.balance))


@transaction.atomic
def set_bet(user, bet) -> dict:
    from game.models import VortexSession

    Wallet, _Txn = _wallet_ops()
    wallet = Wallet.objects.select_for_update().get(user=user)
    ensure_session(user)
    session = VortexSession.objects.select_for_update().get(user=user)
    bet = logic.money_rupees(bet)
    if bet < MIN_BET or bet > MAX_BET:
        raise GameError(f"Bet must be between {MIN_BET} and {MAX_BET}")
    session.bet = bet
    session.save(update_fields=["bet", "updated_at"])
    return snapshot(session, int(wallet.balance))


@transaction.atomic
def spin(user) -> dict:
    from game.models import VortexSession

    Wallet, Txn = _wallet_ops()
    wallet = Wallet.objects.select_for_update().get(user=user)
    ensure_session(user)
    session = VortexSession.objects.select_for_update().get(user=user)

    if session.busy:
        session.busy = False
        session.save(update_fields=["busy", "updated_at"])

    bet = int(session.bet)
    if bet < MIN_BET or bet > MAX_BET:
        raise GameError(f"Bet must be between {MIN_BET} and {MAX_BET}")
    if int(wallet.balance) < bet:
        snap = snapshot(session, int(wallet.balance), message="Not enough balance")
        snap["ok"] = False
        snap["error"] = "Not enough balance"
        raise GameError("Not enough balance")

    before = int(wallet.balance)
    wallet.balance = before - bet
    wallet.save(update_fields=["balance", "updated_at"])
    Txn.objects.create(
        user=user,
        transaction_type="BET",
        amount=bet,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Vortex bet ₹{bet}",
    )
    _sync_redis_balance(user.id, int(wallet.balance))

    session.busy = True
    session.save(update_fields=["busy", "updated_at"])

    try:
        prev = _fill_of(session)
        fill = dict(prev)
        drop = logic.pick_drop()
        message = None
        extra = {"bonus": None, "sector_mult": None, "changed": []}

        if drop == "wind":
            message = "Wind — rings unchanged"
            extra["changed"] = []
        elif drop == "skull":
            fill = logic.apply_rollback(fill)
            extra["changed"] = [k for k in logic.RING_KEYS if fill[k] != prev[k]]
            if extra["changed"]:
                parts = []
                for k in extra["changed"]:
                    before_m = logic.current_mult(prev, k)
                    after_m = logic.current_mult(fill, k)
                    if after_m > 0:
                        parts.append(
                            f"{logic.RINGS[k]['label']} {logic.format_mult(before_m)}X→{logic.format_mult(after_m)}X"
                        )
                    else:
                        parts.append(f"{logic.RINGS[k]['label']} cleared")
                message = "Skull −1 · " + ", ".join(parts)
            else:
                message = "Skull — nothing to decrease"
        else:
            key, _steps = logic.parse_drop(drop)
            if key is None:
                message = "Unknown symbol"
            else:
                fill, bonus, sector_mult = logic.apply_advance(fill, key, 1)
                extra["sector_mult"] = sector_mult
                extra["changed"] = [key]
                if bonus:
                    win_mult = logic.roll_bonus(key)
                    win = logic.money_rupees(Decimal(str(bet)) * Decimal(str(win_mult)))
                    before_w = int(wallet.balance)
                    wallet.balance = before_w + win
                    wallet.save(update_fields=["balance", "updated_at"])
                    Txn.objects.create(
                        user=user,
                        transaction_type="WIN",
                        amount=win,
                        balance_before=before_w,
                        balance_after=int(wallet.balance),
                        description=f"Vortex {logic.RINGS[key]['label']} bonus ₹{win} ({win_mult}X)",
                    )
                    _sync_redis_balance(user.id, int(wallet.balance))
                    fill[key] = 0
                    extra["bonus"] = {
                        "ring": key,
                        "mult": win_mult,
                        "win": win,
                    }
                    message = f"{logic.RINGS[key]['label']} BONUS +₹{win} ({win_mult}X)"
                else:
                    mult = sector_mult
                    payout = logic.money_rupees(Decimal(str(bet)) * Decimal(str(logic.total_mult(fill))))
                    message = (
                        f"{logic.RINGS[key]['label']} → {logic.format_mult(mult)}X"
                        f"  (total {logic.format_mult(logic.total_mult(fill))}X · ₹{payout})"
                    )

        _set_fill(session, fill)
        session.busy = False
        session.save()
        return snapshot(session, int(wallet.balance), message=message, drop=drop, extra=extra)
    except Exception:
        session.busy = False
        session.save(update_fields=["busy", "updated_at"])
        raise


@transaction.atomic
def cashout(user) -> dict:
    from game.models import VortexSession

    Wallet, Txn = _wallet_ops()
    wallet = Wallet.objects.select_for_update().get(user=user)
    ensure_session(user)
    session = VortexSession.objects.select_for_update().get(user=user)
    fill = _fill_of(session)
    if sum(fill.values()) <= 0:
        raise GameError("Nothing to cash out")

    mult = logic.total_mult(fill)
    amount = logic.money_rupees(Decimal(str(session.bet)) * Decimal(str(mult)))
    before = int(wallet.balance)
    wallet.balance = before + amount
    wallet.save(update_fields=["balance", "updated_at"])
    Txn.objects.create(
        user=user,
        transaction_type="WIN",
        amount=amount,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Vortex cash out ₹{amount} ({mult}X)",
    )
    _sync_redis_balance(user.id, int(wallet.balance))
    _set_fill(session, {"water": 0, "earth": 0, "fire": 0})
    session.save()
    return snapshot(
        session,
        int(wallet.balance),
        message=f"Cash Out +₹{amount} ({mult}X)",
        extra={"cashed": amount},
    )


@transaction.atomic
def part(user) -> dict:
    from game.models import VortexSession

    Wallet, Txn = _wallet_ops()
    wallet = Wallet.objects.select_for_update().get(user=user)
    ensure_session(user)
    session = VortexSession.objects.select_for_update().get(user=user)
    fill = _fill_of(session)
    if not logic.can_part(fill):
        raise GameError("Part payout unavailable")

    amount = logic.part_amount(fill, session.bet)
    for key in ("water", "earth", "fire"):
        if fill[key] >= 2:
            fill[key] -= 1
    before = int(wallet.balance)
    wallet.balance = before + amount
    wallet.save(update_fields=["balance", "updated_at"])
    Txn.objects.create(
        user=user,
        transaction_type="WIN",
        amount=amount,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Vortex part payout ₹{amount}",
    )
    _sync_redis_balance(user.id, int(wallet.balance))
    _set_fill(session, fill)
    session.save()
    return snapshot(
        session,
        int(wallet.balance),
        message=f"Part Payout +₹{amount}",
        extra={"cashed": amount},
    )
