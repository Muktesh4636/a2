"""Trading operations against real Gundu Wallet + JWT user."""

from __future__ import annotations

import logging
from django.db import transaction
from django.db.models import Sum

from accounts.models import Transaction as Txn, Wallet
from game.models import TradingPendingBet, TradingRound, TradingUndoEntry

logger = logging.getLogger("game")

COMMISSION = 0.03  # 3% cashout fee


class GameError(Exception):
    pass


def _sync_redis_balance(user_id: int, balance: int) -> None:
    try:
        from game.utils import get_redis_client

        r = get_redis_client()
        if r:
            r.set(f"user_balance:{user_id}", str(balance), ex=86400)
    except Exception as exc:
        logger.warning("trading redis balance sync failed: %s", exc)


def _wallet_balance(user) -> int:
    return int(Wallet.objects.get(user=user).balance)


def portfolio_at_pct(stake: int, side: str, pct: float) -> int:
    """Mark-to-market portfolio value in integer rupees."""
    if stake <= 0 or not side:
        return 0
    aligned = pct if side == "up" else -pct
    raw = stake * (1.0 + aligned / 100.0)
    return int(round(max(0.0, min(float(stake * 2), raw))))


def cashout_payout(stake: int, side: str, live_pct: float) -> int:
    raw = portfolio_at_pct(stake, side, live_pct)
    return int(round(raw * (1.0 - COMMISSION)))


def pending_payload(user) -> dict | None:
    bet = TradingPendingBet.objects.filter(user=user).first()
    if not bet:
        return None
    return {"side": bet.side, "stake": int(bet.stake)}


def crowd_payload() -> dict:
    """Fake market base (₹8k–18k, uneven) + real user stakes on top."""
    from game import trading_engine as engine

    st = engine.load_state()
    crowd = st.get("crowd") or engine.generate_crowd()
    up_qs = TradingPendingBet.objects.filter(side="up")
    down_qs = TradingPendingBet.objects.filter(side="down")
    real_up = int(up_qs.aggregate(t=Sum("stake"))["t"] or 0)
    real_down = int(down_qs.aggregate(t=Sum("stake"))["t"] or 0)
    return {
        "up_amount": int(crowd.get("up_amount") or 0) + real_up,
        "down_amount": int(crowd.get("down_amount") or 0) + real_down,
        "up_players": int(crowd.get("up_players") or 0) + up_qs.count(),
        "down_players": int(crowd.get("down_players") or 0) + down_qs.count(),
    }


def user_payload(user) -> dict:
    pending = pending_payload(user)
    from game import trading_engine as engine

    st = engine.load_state()
    live = float(st.get("live_pct") or 0)
    portfolio = 0
    if pending and st.get("phase") == engine.PHASE_TRADING:
        portfolio = portfolio_at_pct(pending["stake"], pending["side"], live)
    elif pending and st.get("phase") == engine.PHASE_BETTING:
        portfolio = pending["stake"]
    return {
        "balance": _wallet_balance(user),
        "pending": pending,
        "portfolio": portfolio,
        "total_bet": pending["stake"] if pending else 0,
        "username": user.username,
        "user_id": user.id,
        "crowd": crowd_payload(),
    }


@transaction.atomic
def place_bet(user, side: str, amount: int):
    from game.trading_engine import is_betting_open

    if not is_betting_open():
        raise GameError("betting closed — wait for next round")
    side = (side or "").lower().strip()
    if side not in ("up", "down"):
        raise GameError("side must be up or down")
    if amount <= 0:
        raise GameError("amount must be positive")

    wallet = Wallet.objects.select_for_update().get(user=user)
    if wallet.balance < amount:
        raise GameError("insufficient balance")

    bet = TradingPendingBet.objects.select_for_update().filter(user=user).first()
    if bet is None:
        before = int(wallet.balance)
        wallet.balance -= amount
        wallet.save(update_fields=["balance", "updated_at"])
        TradingPendingBet.objects.create(user=user, side=side, stake=amount)
        TradingUndoEntry.objects.create(user=user, chip=amount, side=side, action="add")
        Txn.objects.create(
            user=user,
            transaction_type="BET",
            amount=-amount,
            balance_before=before,
            balance_after=int(wallet.balance),
            description=f"Trading bet {side.upper()} ₹{amount}",
        )
        _sync_redis_balance(user.id, int(wallet.balance))
        return user

    if bet.side == side:
        before = int(wallet.balance)
        wallet.balance -= amount
        wallet.save(update_fields=["balance", "updated_at"])
        bet.stake += amount
        bet.save(update_fields=["stake", "updated_at"])
        TradingUndoEntry.objects.create(user=user, chip=amount, side=side, action="add")
        Txn.objects.create(
            user=user,
            transaction_type="BET",
            amount=-amount,
            balance_before=before,
            balance_after=int(wallet.balance),
            description=f"Trading add {side.upper()} ₹{amount}",
        )
        _sync_redis_balance(user.id, int(wallet.balance))
        return user

    # Flip side without extra debit
    prev = bet.side
    bet.side = side
    bet.save(update_fields=["side", "updated_at"])
    TradingUndoEntry.objects.create(user=user, chip=0, side=prev, action="flip")
    return user


@transaction.atomic
def undo_bet(user):
    from game.trading_engine import is_betting_open

    if not is_betting_open():
        raise GameError("betting closed — wait for next round")
    wallet = Wallet.objects.select_for_update().get(user=user)
    last = TradingUndoEntry.objects.filter(user=user).order_by("-id").first()
    if last is None:
        raise GameError("nothing to undo")

    bet = TradingPendingBet.objects.select_for_update().filter(user=user).first()
    if last.action == "flip":
        if bet:
            bet.side = last.side
            bet.save(update_fields=["side", "updated_at"])
        last.delete()
        return user

    if bet is None:
        last.delete()
        raise GameError("pending bet missing")

    chip = int(last.chip)
    next_stake = bet.stake - chip
    if next_stake <= 0:
        bet.delete()
    else:
        bet.stake = next_stake
        bet.save(update_fields=["stake", "updated_at"])

    before = int(wallet.balance)
    wallet.balance += chip
    wallet.save(update_fields=["balance", "updated_at"])
    last.delete()
    Txn.objects.create(
        user=user,
        transaction_type="REFUND",
        amount=chip,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Trading undo ₹{chip}",
    )
    _sync_redis_balance(user.id, int(wallet.balance))
    return user


@transaction.atomic
def cashout(user):
    from game import trading_engine as engine

    if not engine.is_trading_open():
        raise GameError("cashout only during trading")
    st = engine.load_state()
    live_pct = float(st.get("live_pct") or 0)

    wallet = Wallet.objects.select_for_update().get(user=user)
    bet = TradingPendingBet.objects.select_for_update().filter(user=user).first()
    if bet is None:
        raise GameError("no open position")

    stake = int(bet.stake)
    side = bet.side
    payout = cashout_payout(stake, side, live_pct)
    before = int(wallet.balance)
    wallet.balance += payout
    wallet.save(update_fields=["balance", "updated_at"])

    TradingRound.objects.create(
        user=user,
        shared_round=int(st.get("round") or 0),
        final_pct=live_pct,
        side=side,
        stake=stake,
        payout=payout,
        cashed_out=True,
    )
    bet.delete()
    TradingUndoEntry.objects.filter(user=user).delete()

    Txn.objects.create(
        user=user,
        transaction_type="WIN",
        amount=payout,
        balance_before=before,
        balance_after=int(wallet.balance),
        description=f"Trading cashout {side.upper()} @ {live_pct:+.1f}% payout ₹{payout}",
    )
    _sync_redis_balance(user.id, int(wallet.balance))
    engine.set_user_win(int(st.get("round") or 0), user.id, payout)

    entry = stake or 1
    mult = int(round((payout / entry) * 100 - 100))
    engine.push_cashout_feed(int(st.get("round") or 0), user.username, mult, payout)
    return {"payout": payout, "balance": int(wallet.balance), "live_pct": live_pct}


@transaction.atomic
def settle_user_for_pct(user, final_pct: float, shared_round: int) -> int:
    from game.trading_engine import set_user_win

    wallet = Wallet.objects.select_for_update().get(user=user)
    bet = TradingPendingBet.objects.select_for_update().filter(user=user).first()
    if bet is None:
        set_user_win(shared_round, user.id, 0)
        return 0

    stake = int(bet.stake)
    side = bet.side
    payout = portfolio_at_pct(stake, side, final_pct)
    before = int(wallet.balance)
    if payout:
        wallet.balance += payout
        wallet.save(update_fields=["balance", "updated_at"])
        Txn.objects.create(
            user=user,
            transaction_type="WIN",
            amount=payout,
            balance_before=before,
            balance_after=int(wallet.balance),
            description=f"Trading settle {side.upper()} @ {final_pct:+.1f}% payout ₹{payout} (round {shared_round})",
        )
        _sync_redis_balance(user.id, int(wallet.balance))

    TradingRound.objects.create(
        user=user,
        shared_round=shared_round,
        final_pct=final_pct,
        side=side,
        stake=stake,
        payout=payout,
        cashed_out=False,
    )
    bet.delete()
    TradingUndoEntry.objects.filter(user=user).delete()
    set_user_win(shared_round, user.id, payout)
    return payout


def settle_all_pending_for_pct(final_pct: float, shared_round: int) -> int:
    user_ids = list(TradingPendingBet.objects.values_list("user_id", flat=True).distinct())
    settled = 0
    for uid in user_ids:
        try:
            from django.contrib.auth import get_user_model

            user = get_user_model().objects.get(pk=uid)
            settle_user_for_pct(user, final_pct, shared_round)
            settled += 1
        except Exception as exc:
            logger.exception("trading settle failed user=%s: %s", uid, exc)
    return settled


def history(user, limit: int = 20) -> list[dict]:
    limit = max(1, min(limit, 100))
    rows = TradingRound.objects.filter(user=user)[:limit]
    return [
        {
            "id": r.id,
            "shared_round": r.shared_round,
            "final_pct": r.final_pct,
            "side": r.side,
            "stake": r.stake,
            "payout": r.payout,
            "cashed_out": r.cashed_out,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
