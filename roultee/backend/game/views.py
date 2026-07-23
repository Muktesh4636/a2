from functools import wraps

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from game import services
from game.serializers import PlaceBetSerializer, SpinSerializer
from game.services import GameError


def require_session(view_method):
    @wraps(view_method)
    def wrapper(self, request, *args, **kwargs):
        token = request.headers.get("X-Session-Token") or request.META.get("HTTP_X_SESSION_TOKEN")
        if not token:
            return Response(
                {"detail": "X-Session-Token header required"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        try:
            request.player = services.get_player(token)
        except GameError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_401_UNAUTHORIZED)
        return view_method(self, request, *args, **kwargs)

    return wrapper


def player_payload(player) -> dict:
    return {
        "session_token": str(player.session_key),
        "balance": player.balance,
        "pending_bets": services.pending_bets_payload(player),
        "total_bet": services.total_pending(player),
    }


class SessionCreateView(APIView):
    """POST /api/session/ — create a guest player."""

    def post(self, request):
        player = services.create_player()
        return Response(player_payload(player), status=status.HTTP_201_CREATED)


class MeView(APIView):
    """GET /api/me/ — current balance and pending bets."""

    @require_session
    def get(self, request):
        return Response(player_payload(request.player))


class PlaceBetView(APIView):
    """POST /api/bets/"""

    @require_session
    def post(self, request):
        ser = PlaceBetSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            player = services.place_bet(
                request.player,
                ser.validated_data["key"],
                ser.validated_data["amount"],
            )
        except GameError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(player_payload(player))


class UndoBetView(APIView):
    """POST /api/bets/undo/"""

    @require_session
    def post(self, request):
        try:
            player = services.undo_bet(request.player)
        except GameError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(player_payload(player))


class DoubleBetsView(APIView):
    """POST /api/bets/double/"""

    @require_session
    def post(self, request):
        try:
            player = services.double_bets(request.player)
        except GameError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(player_payload(player))


class ClearBetsView(APIView):
    """POST /api/bets/clear/"""

    @require_session
    def post(self, request):
        player = services.clear_bets(request.player)
        return Response(player_payload(player))


class SpinView(APIView):
    """POST /api/spin/ — server rolls and settles."""

    @require_session
    def post(self, request):
        ser = SpinSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        forced = ser.validated_data.get("number")
        try:
            result = services.spin(request.player, forced_number=forced)
        except GameError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "number": result.number,
                "win": result.win,
                "balance": result.balance,
                "stake": result.total_stake,
                "round_id": result.round_id,
                "winning_keys": result.winning_keys,
                "pending_bets": [],
                "total_bet": 0,
                "history": services.history(request.player, limit=10),
            }
        )


class HistoryView(APIView):
    """GET /api/history/"""

    @require_session
    def get(self, request):
        try:
            limit = int(request.query_params.get("limit", 20))
        except (TypeError, ValueError):
            limit = 20
        return Response({"results": services.history(request.player, limit=limit)})
