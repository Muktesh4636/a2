from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .constants import (
    DIFFICULTIES,
    HIT_CHANCE,
    MAX_BET,
    MAX_WIN,
    MIN_BET,
    MULTIPLIERS,
    START_BALANCE,
)
from . import services
from .models import Round
from .services import GameError, public_round


PLAYER_HEADER = "HTTP_X_PLAYER_TOKEN"


def player_from_request(request):
    token = request.META.get(PLAYER_HEADER) or request.headers.get("X-Player-Token")
    return services.get_or_create_player(token)


def error_response(exc: GameError):
    return Response({"detail": exc.message}, status=exc.status)


class ConfigView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        return Response(
            {
                "min_bet": MIN_BET,
                "max_bet": MAX_BET,
                "max_win": MAX_WIN,
                "start_balance": START_BALANCE,
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
        )


class PlayerMeView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        player = player_from_request(request)
        active = (
            Round.objects.filter(player=player, status=Round.Status.ACTIVE)
            .order_by("-created_at")
            .first()
        )
        return Response(
            {
                "token": player.token,
                "balance": str(player.balance),
                "active_round": public_round(active) if active else None,
            }
        )


class PlayerResetView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        player = player_from_request(request)
        player = services.reset_balance(player)
        return Response({"token": player.token, "balance": str(player.balance)})


class RoundStartView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        player = player_from_request(request)
        try:
            round_obj = services.start_round(
                player,
                bet=request.data.get("bet"),
                difficulty=request.data.get("difficulty", "easy"),
                client_seed=request.data.get("client_seed", ""),
            )
        except GameError as exc:
            return error_response(exc)
        except (TypeError, ValueError):
            return Response({"detail": "Invalid bet"}, status=status.HTTP_400_BAD_REQUEST)

        player.refresh_from_db()
        return Response(
            {
                "token": player.token,
                "balance": str(player.balance),
                "round": public_round(round_obj),
            },
            status=status.HTTP_201_CREATED,
        )


class RoundStepView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request, round_id):
        player = player_from_request(request)
        try:
            result = services.step_round(player, round_id)
        except GameError as exc:
            return error_response(exc)

        payload = {
            "token": player.token,
            "balance": str(result["balance"]),
            "survived": result["survived"],
            "crashed": result["crashed"],
            "completed": result.get("completed", False),
            "step": result["step"],
            "multiplier": result["multiplier"],
            "potential": str(result["potential"]),
            "round": public_round(result["round"]),
        }
        if "payout" in result:
            payload["payout"] = str(result["payout"])
        if "reveal" in result:
            payload["reveal"] = result["reveal"]
        return Response(payload)


class RoundCashOutView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request, round_id):
        player = player_from_request(request)
        try:
            result = services.cash_out(player, round_id)
        except GameError as exc:
            return error_response(exc)

        return Response(
            {
                "token": player.token,
                "balance": str(result["balance"]),
                "payout": str(result["payout"]),
                "round": public_round(result["round"]),
                "reveal": result["reveal"],
            }
        )


class RoundDetailView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, round_id):
        player = player_from_request(request)
        try:
            round_obj = Round.objects.get(pk=round_id, player=player)
        except Round.DoesNotExist:
            return Response({"detail": "Round not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response({"round": public_round(round_obj)})


class RoundHistoryView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        player = player_from_request(request)
        rounds = (
            Round.objects.filter(player=player)
            .exclude(status=Round.Status.ACTIVE)
            .order_by("-created_at")[:20]
        )
        data = []
        for r in rounds:
            data.append({
                "id": str(r.id),
                "bet": str(r.bet),
                "payout": str(r.payout),
                "status": r.status,
                "difficulty": r.difficulty,
                "step": r.step,
                "created_at": r.created_at.strftime("%d %b %H:%M"),
            })
        return Response({"history": data})


class HealthView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        return Response({"status": "ok", "service": "chicken-road-2-api"})
