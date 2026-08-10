from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Bet
from .multipliers import VALID_RISKS, VALID_ROWS, get_multipliers
from .serializers import (
    BetSerializer,
    PlaceBetSerializer,
    PlayerSerializer,
    ResetBalanceSerializer,
)
from .services import get_or_create_player, place_bet, reset_balance

PLAYER_HEADER = "X-Player-Token"


def _player_from_request(request):
    token = request.headers.get(PLAYER_HEADER) or request.META.get(
        "HTTP_X_PLAYER_TOKEN"
    )
    return get_or_create_player(token)


class HealthView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        return Response({"status": "ok", "service": "plinko-backend"})


class PlayerMeView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        player, token = _player_from_request(request)
        data = PlayerSerializer(player).data
        return Response({"player": data, "token": token})


class PlayerResetView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        player, token = _player_from_request(request)
        ser = ResetBalanceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        player = reset_balance(player, ser.validated_data.get("balance", 1000))
        return Response(
            {"player": PlayerSerializer(player).data, "token": token}
        )


class MultipliersView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        risk = request.query_params.get("risk", "high")
        rows = request.query_params.get("rows", "16")

        try:
            rows = int(rows)
            multipliers = get_multipliers(risk, rows)
        except (TypeError, ValueError) as exc:
            return Response(
                {
                    "detail": str(exc),
                    "valid_risks": sorted(VALID_RISKS),
                    "valid_rows": sorted(VALID_ROWS),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "risk": risk,
                "rows": rows,
                "multipliers": multipliers,
                "slots": len(multipliers),
            }
        )


class PlaceBetView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        player, token = _player_from_request(request)
        ser = PlaceBetSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        try:
            bet = place_bet(
                player,
                amount=data["amount"],
                risk=data["risk"],
                rows=data["rows"],
                bucket_index=data.get("bucket_index"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        player.refresh_from_db()
        return Response(
            {
                "bet": BetSerializer(bet).data,
                "player": PlayerSerializer(player).data,
                "token": token,
            },
            status=status.HTTP_201_CREATED,
        )


class BetHistoryView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        player, token = _player_from_request(request)
        limit = min(int(request.query_params.get("limit", 40)), 100)
        bets = Bet.objects.filter(player=player)[:limit]
        return Response(
            {
                "results": BetSerializer(bets, many=True).data,
                "token": token,
                "player": PlayerSerializer(player).data,
            }
        )
