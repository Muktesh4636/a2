from django.conf import settings
from django.db import transaction
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import GameSession, Round
from .services import resolve_round, start_round


def _session_payload(session: GameSession) -> dict:
    pending = session.rounds.filter(status=Round.Status.PENDING).first()
    payload = {
        "session_id": str(session.id),
        "bankroll": session.bankroll,
        "allowed_chips": list(settings.ALLOWED_CHIPS),
        "payouts": dict(settings.PAYOUTS),
        "ante_payout": settings.ANTE_PAYOUT,
        "play_payouts": dict(settings.PLAY_PAYOUTS),
        "pending_round": None,
    }
    if pending:
        payload["pending_round"] = {
            "round_id": pending.id,
            "phase": "decide",
            "ante": pending.ante,
            "player_cards": pending.player_card_dicts(),
            "player_hand": pending.player_hand,
            "bankroll": session.bankroll,
        }
    return payload


def _store_pending(session: GameSession, result: dict) -> Round:
    p = result["player_cards"]
    d = result["dealer_cards"]
    return Round.objects.create(
        session=session,
        status=Round.Status.PENDING,
        ante=result["ante"],
        play_chip=0,
        action="",
        p1_label=p[0]["label"],
        p1_value=p[0]["value"],
        p1_symbol=p[0]["symbol"],
        p1_red=p[0]["red"],
        p2_label=p[1]["label"],
        p2_value=p[1]["value"],
        p2_symbol=p[1]["symbol"],
        p2_red=p[1]["red"],
        p3_label=p[2]["label"],
        p3_value=p[2]["value"],
        p3_symbol=p[2]["symbol"],
        p3_red=p[2]["red"],
        d1_label=d[0]["label"],
        d1_value=d[0]["value"],
        d1_symbol=d[0]["symbol"],
        d1_red=d[0]["red"],
        d2_label=d[1]["label"],
        d2_value=d[1]["value"],
        d2_symbol=d[1]["symbol"],
        d2_red=d[1]["red"],
        d3_label=d[2]["label"],
        d3_value=d[2]["value"],
        d3_symbol=d[2]["symbol"],
        d3_red=d[2]["red"],
        player_hand=result["player_hand"],
        dealer_hand=result["dealer_hand"],
        dealer_qualified=False,
        outcome="",
        won=False,
        payout=0,
        bankroll_after=result["bankroll"],
    )


def _apply_resolve(round_obj: Round, result: dict) -> None:
    round_obj.status = Round.Status.RESOLVED
    round_obj.play_chip = result["play_chip"]
    round_obj.action = result["action"]
    round_obj.player_hand = result["player_hand"]
    round_obj.dealer_hand = result["dealer_hand"]
    round_obj.dealer_qualified = result["dealer_qualified"]
    round_obj.outcome = result["outcome"]
    round_obj.won = result["won"]
    round_obj.payout = result["payout"]
    round_obj.bankroll_after = result["bankroll"]
    round_obj.save()


@api_view(["POST"])
def create_session(request):
    session = GameSession.objects.create(bankroll=settings.STARTING_BANKROLL)
    return Response(
        {
            **_session_payload(session),
            "starting_bankroll": settings.STARTING_BANKROLL,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
def get_session(request, session_id):
    session = get_object_or_404(GameSession, id=session_id)
    return Response(_session_payload(session))


@api_view(["POST"])
def reset_session(request, session_id):
    session = get_object_or_404(GameSession, id=session_id)
    session.rounds.filter(status=Round.Status.PENDING).update(
        status=Round.Status.RESOLVED,
        action="fold",
        outcome="fold",
    )
    session.bankroll = settings.STARTING_BANKROLL
    session.save(update_fields=["bankroll", "updated_at"])
    return Response(_session_payload(session))


@api_view(["POST"])
@transaction.atomic
def deal(request):
    session_id = request.data.get("session_id")
    chip = request.data.get("chip")

    if not session_id:
        return Response({"error": "session_id is required"}, status=400)

    try:
        chip = int(chip)
    except (TypeError, ValueError):
        return Response({"error": "chip must be an integer"}, status=400)

    session = get_object_or_404(GameSession.objects.select_for_update(), id=session_id)

    if session.rounds.filter(status=Round.Status.PENDING).exists():
        return Response(
            {"error": "Finish the current hand (Play or Fold) first."},
            status=400,
        )

    try:
        result = start_round(chip, session.bankroll)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)

    session.bankroll = result["bankroll"]
    session.save(update_fields=["bankroll", "updated_at"])
    round_obj = _store_pending(session, result)

    return Response(
        {
            "session_id": str(session.id),
            "round_id": round_obj.id,
            "phase": "decide",
            "ante": result["ante"],
            "player_cards": result["player_cards"],
            "player_hand": result["player_hand"],
            "player_hand_label": result["player_hand_label"],
            "bankroll": result["bankroll"],
            "play_payouts": result["play_payouts"],
            "ante_payout": result["ante_payout"],
        }
    )


@api_view(["POST"])
@transaction.atomic
def decide(request):
    session_id = request.data.get("session_id")
    round_id = request.data.get("round_id")
    action = request.data.get("action")

    if not session_id:
        return Response({"error": "session_id is required"}, status=400)
    if not round_id:
        return Response({"error": "round_id is required"}, status=400)

    session = get_object_or_404(GameSession.objects.select_for_update(), id=session_id)
    round_obj = get_object_or_404(
        Round.objects.select_for_update(),
        id=round_id,
        session=session,
    )

    if round_obj.status != Round.Status.PENDING:
        return Response({"error": "This hand is already finished."}, status=400)

    try:
        result = resolve_round(
            action=action,
            ante=round_obj.ante,
            bankroll=session.bankroll,
            player_cards=round_obj.player_card_dicts(),
            dealer_cards=round_obj.dealer_card_dicts(),
        )
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)

    session.bankroll = result["bankroll"]
    session.save(update_fields=["bankroll", "updated_at"])
    _apply_resolve(round_obj, result)

    return Response(
        {
            "session_id": str(session.id),
            "round_id": round_obj.id,
            **result,
        }
    )


@api_view(["GET"])
def session_history(request, session_id):
    session = get_object_or_404(GameSession, id=session_id)
    rounds = session.rounds.filter(status=Round.Status.RESOLVED)[:50]
    return Response(
        {
            "session_id": str(session.id),
            "bankroll": session.bankroll,
            "rounds": [
                {
                    "id": r.id,
                    "ante": r.ante,
                    "play_chip": r.play_chip,
                    "action": r.action,
                    "player_hand": r.player_hand,
                    "dealer_hand": r.dealer_hand,
                    "dealer_qualified": r.dealer_qualified,
                    "outcome": r.outcome,
                    "won": r.won,
                    "payout": r.payout,
                    "bankroll_after": r.bankroll_after,
                    "created_at": r.created_at.isoformat(),
                }
                for r in rounds
            ],
        }
    )


@ensure_csrf_cookie
def index(request):
    path = settings.FRONTEND_DIR / "index.html"
    if not path.exists():
        raise Http404("Frontend index.html not found")
    return FileResponse(path.open("rb"), content_type="text/html")
