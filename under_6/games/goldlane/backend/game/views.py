from django.conf import settings
from django.db import transaction
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import GameSession, Round
from .services import deal_round


@api_view(["POST"])
def create_session(request):
    session = GameSession.objects.create(bankroll=settings.STARTING_BANKROLL)
    return Response(
        {
            "session_id": str(session.id),
            "bankroll": session.bankroll,
            "starting_bankroll": settings.STARTING_BANKROLL,
            "allowed_chips": list(settings.ALLOWED_CHIPS),
            "payouts": dict(settings.PAYOUTS),
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
def get_session(request, session_id):
    session = get_object_or_404(GameSession, id=session_id)
    return Response(
        {
            "session_id": str(session.id),
            "bankroll": session.bankroll,
            "allowed_chips": list(settings.ALLOWED_CHIPS),
            "payouts": dict(settings.PAYOUTS),
        }
    )


@api_view(["POST"])
def reset_session(request, session_id):
    session = get_object_or_404(GameSession, id=session_id)
    session.bankroll = settings.STARTING_BANKROLL
    session.save(update_fields=["bankroll", "updated_at"])
    return Response(
        {
            "session_id": str(session.id),
            "bankroll": session.bankroll,
        }
    )


@api_view(["POST"])
@transaction.atomic
def deal(request):
    session_id = request.data.get("session_id")
    bet_side = request.data.get("side")
    chip = request.data.get("chip")

    if not session_id:
        return Response({"error": "session_id is required"}, status=400)

    try:
        chip = int(chip)
    except (TypeError, ValueError):
        return Response({"error": "chip must be an integer"}, status=400)

    session = get_object_or_404(GameSession.objects.select_for_update(), id=session_id)

    try:
        result = deal_round(bet_side, chip, session.bankroll)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)

    session.bankroll = result["bankroll"]
    session.save(update_fields=["bankroll", "updated_at"])

    Round.objects.create(
        session=session,
        bet_side=result["bet_side"],
        chip=result["chip"],
        card1_label=result["card1"]["label"],
        card1_value=result["card1"]["value"],
        card1_symbol=result["card1"]["symbol"],
        card1_red=result["card1"]["red"],
        card2_label=result["card2"]["label"],
        card2_value=result["card2"]["value"],
        card2_symbol=result["card2"]["symbol"],
        card2_red=result["card2"]["red"],
        sum_value=result["sum"],
        result_side=result["result_side"],
        won=result["won"],
        payout=result["payout"],
        bankroll_after=result["bankroll"],
    )

    return Response(
        {
            "session_id": str(session.id),
            **result,
        }
    )


@api_view(["GET"])
def session_history(request, session_id):
    session = get_object_or_404(GameSession, id=session_id)
    rounds = session.rounds.all()[:50]
    return Response(
        {
            "session_id": str(session.id),
            "bankroll": session.bankroll,
            "rounds": [
                {
                    "id": r.id,
                    "bet_side": r.bet_side,
                    "chip": r.chip,
                    "sum": r.sum_value,
                    "result_side": r.result_side,
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
