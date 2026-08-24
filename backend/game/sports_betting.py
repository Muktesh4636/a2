"""Place bets on soccer / tennis markets from Redis feed cache."""

from __future__ import annotations

import logging
from decimal import Decimal, ROUND_DOWN

from django.db import transaction as db_transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from game import sports_feed as feed

logger = logging.getLogger("game")


class CashOutError(Exception):
    def __init__(self, message: str, http_status: int = status.HTTP_400_BAD_REQUEST):
        super().__init__(message)
        self.http_status = http_status


def compute_cash_out_amount(stake, bet_odds, current_odds) -> int:
    """Cancel payout = stake × (bet_odds ÷ current_odds), rounded down to rupees."""
    stake_d = Decimal(str(stake))
    bet_d = Decimal(str(bet_odds))
    cur_d = Decimal(str(current_odds))
    if stake_d <= 0 or bet_d <= 1 or cur_d <= 1:
        return 0
    amount = (stake_d * bet_d / cur_d).quantize(Decimal("1"), rounding=ROUND_DOWN)
    return max(0, int(amount))


def _markets_from_match(match: dict) -> list:
    return (match.get("odds") or {}).get("markets") or match.get("markets") or []


def _outcome_decimal(match: dict, market_id: int, outcome_id: int) -> Decimal | None:
    market_obj = next((m for m in _markets_from_match(match) if m.get("id") == market_id), None)
    if market_obj is None:
        return None
    outcome_obj = next(
        (o for o in (market_obj.get("outcomes") or []) if o.get("id") == outcome_id),
        None,
    )
    if outcome_obj is None:
        return None
    try:
        dec = Decimal(str(outcome_obj.get("price_decimal")))
    except Exception:
        return None
    if dec <= 1:
        return None
    return dec


def _find_cached_match(sport: str, event_id: int) -> dict | None:
    keys = feed._keys(sport)
    found = None
    for key in (keys["matches"], keys["upcoming"], keys["odds"]):
        for m in feed.cache_get(key) or []:
            if m.get("id") == event_id:
                found = m
                break
        if found is not None:
            break
    if found is None:
        return None
    markets = (found.get("odds") or {}).get("markets") or []
    if markets:
        return found
    for key in (keys["odds"], keys["matches"], keys["upcoming"]):
        for m in feed.cache_get(key) or []:
            if m.get("id") == event_id and (m.get("odds") or {}).get("markets"):
                merged = dict(found)
                merged["odds"] = m.get("odds")
                return merged
    return found


def place_sports_bet(request, sport: str):
    from accounts.models import Transaction as Txn
    from accounts.models import Wallet
    from game.models import SportsBet

    sport = (sport or "").lower().strip()
    if sport not in feed.SPORTS:
        return Response({"error": f"Unknown sport: {sport}"}, status=status.HTTP_400_BAD_REQUEST)

    data = request.data
    required = ["event_id", "market_id", "outcome_id", "stake"]
    missing = [f for f in required if f not in data]
    if missing:
        return Response(
            {"error": f"Missing fields: {', '.join(missing)}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        stake = int(data["stake"])
        event_id = int(data["event_id"])
        market_id = int(data["market_id"])
        outcome_id = int(data["outcome_id"])
    except (ValueError, TypeError):
        return Response(
            {"error": "event_id, market_id, outcome_id and stake must be integers"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if stake <= 0:
        return Response({"error": "stake must be positive"}, status=status.HTTP_400_BAD_REQUEST)

    match = _find_cached_match(sport, event_id)
    if not match:
        return Response(
            {"error": f"Event {event_id} not found in live/upcoming data"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    event_name = match.get("match") or ""
    markets = (match.get("odds") or {}).get("markets") or []
    market_obj = next((m for m in markets if m.get("id") == market_id), None)
    if market_obj is None:
        return Response(
            {"error": f"Market {market_id} not found for this event"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    market_status = (market_obj.get("status") or "OPEN").upper()
    if market_status not in ("OPEN", "ACTIVE", ""):
        return Response(
            {"error": f'Market "{market_obj.get("description")}" is not open for betting'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    market_name = market_obj.get("description") or ""
    outcome_obj = next(
        (o for o in (market_obj.get("outcomes") or []) if o.get("id") == outcome_id),
        None,
    )
    if outcome_obj is None:
        return Response(
            {"error": f"Outcome {outcome_id} not found in market"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if outcome_obj.get("hidden") or outcome_obj.get("withdrawn"):
        return Response(
            {"error": "This outcome is no longer available"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    outcome_name = outcome_obj.get("description") or ""
    try:
        real_odds = Decimal(str(outcome_obj.get("price_decimal")))
    except Exception:
        real_odds = None

    if real_odds is None or real_odds <= 1:
        return Response(
            {"error": "Odds not available or invalid for this outcome"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    potential_payout = int(Decimal(stake) * real_odds)

    try:
        with db_transaction.atomic():
            wallet = Wallet.objects.select_for_update().get(user=request.user)
            if wallet.balance < stake:
                return Response(
                    {"error": f"Insufficient balance. Need {stake}, have {wallet.balance}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            balance_before = wallet.balance
            wallet.balance -= stake
            if hasattr(wallet, "turnover"):
                wallet.turnover = (wallet.turnover or 0) + stake
                wallet.save(update_fields=["balance", "turnover", "updated_at"])
            else:
                wallet.save(update_fields=["balance", "updated_at"])

            bet = SportsBet.objects.create(
                user=request.user,
                sport=sport,
                event_id=event_id,
                event_name=event_name[:255],
                market_id=market_id,
                market_name=market_name[:255],
                outcome_id=outcome_id,
                outcome_name=outcome_name[:255],
                odds=real_odds,
                stake=stake,
                potential_payout=potential_payout,
                status="PENDING",
            )

            Txn.objects.create(
                user=request.user,
                transaction_type="BET",
                amount=-stake,
                balance_before=balance_before,
                balance_after=wallet.balance,
                description=(
                    f"{sport.title()} bet #{bet.id}: {event_name} / {market_name} / "
                    f"{outcome_name} @ {real_odds}"
                ),
            )

        return Response(
            {
                "id": bet.id,
                "sport": bet.sport,
                "event_id": bet.event_id,
                "event_name": bet.event_name,
                "market_id": bet.market_id,
                "market_name": bet.market_name,
                "outcome_id": bet.outcome_id,
                "outcome_name": bet.outcome_name,
                "odds": str(bet.odds),
                "stake": int(bet.stake),
                "potential_payout": int(bet.potential_payout),
                "status": bet.status,
                "created_at": bet.created_at.isoformat(),
                "wallet_balance": wallet.balance,
            },
            status=status.HTTP_201_CREATED,
        )

    except Wallet.DoesNotExist:
        return Response({"error": "Wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        logger.exception("place_sports_bet sport=%s error: %s", sport, exc)
        return Response({"error": "Failed to place bet"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def my_sports_bets(request, sport: str):
    from game.models import SportsBet

    sport = (sport or "").lower().strip()
    qs = SportsBet.objects.filter(user=request.user)
    if sport:
        qs = qs.filter(sport=sport)
    event_id = request.GET.get("event_id")
    if event_id:
        try:
            qs = qs.filter(event_id=int(event_id))
        except (TypeError, ValueError):
            return Response(
                {"error": "event_id must be an integer"},
                status=status.HTTP_400_BAD_REQUEST,
            )
    bet_status = (request.GET.get("status") or "").upper().strip()
    if bet_status:
        qs = qs.filter(status=bet_status)
    bets = qs.order_by("-created_at")[:50]
    return Response({
        "bets": [
            {
                "id": b.id,
                "sport": b.sport,
                "event_id": b.event_id,
                "event_name": b.event_name,
                "market_id": b.market_id,
                "market_name": b.market_name,
                "outcome_id": b.outcome_id,
                "outcome_name": b.outcome_name,
                "odds": str(b.odds),
                "stake": int(b.stake) if b.stake is not None else 0,
                "potential_payout": int(b.potential_payout) if b.potential_payout is not None else 0,
                "status": b.status,
                "payout_amount": int(b.payout_amount) if b.payout_amount is not None else 0,
                "created_at": b.created_at.isoformat(),
                "settled_at": b.settled_at.isoformat() if b.settled_at else None,
            }
            for b in bets
        ]
    })


def cash_out_sports_bet(request, sport: str, bet_id: int):
    from accounts.models import Transaction as Txn
    from accounts.models import Wallet
    from game.models import SportsBet

    sport = (sport or "").lower().strip()
    try:
        bet = SportsBet.objects.get(pk=bet_id, user=request.user, sport=sport)
    except SportsBet.DoesNotExist:
        return Response({"error": "Bet not found"}, status=status.HTTP_404_NOT_FOUND)

    if bet.status != "PENDING":
        return Response(
            {"error": f"Bet is already {bet.status.lower()}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    match = _find_cached_match(sport, bet.event_id)
    if not match:
        return Response(
            {"error": "Match data not available for cash out"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    current_odds = _outcome_decimal(match, bet.market_id, bet.outcome_id)
    if current_odds is None:
        return Response(
            {"error": "Current odds not available for this selection"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    cash_out = compute_cash_out_amount(bet.stake, bet.odds, current_odds)
    if cash_out <= 0:
        return Response(
            {"error": "Cash out amount is not available right now"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    stake_int = int(bet.stake)
    pnl = cash_out - stake_int

    try:
        with db_transaction.atomic():
            locked = SportsBet.objects.select_for_update().get(pk=bet.pk)
            if locked.status != "PENDING":
                return Response(
                    {"error": f"Bet is already {locked.status.lower()}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            wallet = Wallet.objects.select_for_update().get(user=request.user)
            balance_before = wallet.balance
            wallet.balance += cash_out
            wallet.save(update_fields=["balance", "updated_at"])

            locked.status = "CASHED_OUT"
            locked.payout_amount = cash_out
            locked.settled_at = timezone.now()
            locked.save(update_fields=["status", "payout_amount", "settled_at"])

            Txn.objects.create(
                user=request.user,
                transaction_type="WIN",
                amount=cash_out,
                balance_before=balance_before,
                balance_after=wallet.balance,
                description=(
                    f"{sport.title()} cash out #{locked.id}: {locked.event_name} / "
                    f"{locked.outcome_name} @ {current_odds} → ₹{cash_out}"
                ),
            )

        return Response(
            {
                "id": locked.id,
                "status": locked.status,
                "cash_out_amount": cash_out,
                "pnl": pnl,
                "stake": stake_int,
                "bet_odds": str(locked.odds),
                "current_odds": str(current_odds),
                "wallet_balance": wallet.balance,
            }
        )
    except Wallet.DoesNotExist:
        return Response({"error": "Wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        logger.exception("cash_out_sports_bet sport=%s bet=%s error: %s", sport, bet_id, exc)
        return Response({"error": "Failed to cash out bet"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
