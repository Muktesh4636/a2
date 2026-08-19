from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .models import Bet, GameRound
from .serializers import (
    BetSerializer,
    CashOutSerializer,
    PlaceBetSerializer,
    PlayerSerializer,
    RoundSerializer,
)

TOKEN_HEADER = 'HTTP_X_PLAYER_TOKEN'


def player_from_request(request: Request):
    token = request.META.get(TOKEN_HEADER) or request.headers.get('X-Player-Token')
    return services.get_or_create_player(token)


class BootstrapView(APIView):
    """Create/load demo player + open round + history."""

    authentication_classes: list = []
    permission_classes: list = []

    def get(self, request: Request) -> Response:
        player = player_from_request(request)
        round_obj = services.ensure_open_round()
        round_data = RoundSerializer(round_obj).data
        if round_obj.status == GameRound.Status.WAITING:
            round_data['crash_point'] = None
        return Response(
            {
                'player': PlayerSerializer(player).data,
                'round': round_data,
                'history': services.latest_history(30),
            }
        )


class HistoryView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    def get(self, request: Request) -> Response:
        return Response({'history': services.latest_history(40)})


class CurrentRoundView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    def get(self, request: Request) -> Response:
        round_obj = services.ensure_open_round()
        player = player_from_request(request)
        bets = Bet.objects.filter(player=player, round=round_obj).exclude(
            status=Bet.Status.CANCELLED
        )
        data = RoundSerializer(round_obj).data
        # Only reveal crash_point once flying has started (demo trust model)
        if round_obj.status == GameRound.Status.WAITING:
            data = {**data, 'crash_point': None}
        return Response(
            {
                'round': data,
                'bets': BetSerializer(bets, many=True).data,
                'player': PlayerSerializer(player).data,
            }
        )


class PlaceBetView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    def post(self, request: Request) -> Response:
        ser = PlaceBetSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        player = player_from_request(request)
        try:
            bet = services.place_bet(
                player=player,
                panel=ser.validated_data['panel'],
                amount=ser.validated_data['amount'],
                auto_cashout=ser.validated_data.get('auto_cashout'),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        player.refresh_from_db()
        return Response(
            {
                'bet': BetSerializer(bet).data,
                'player': PlayerSerializer(player).data,
            }
        )


class StartRoundView(APIView):
    """Frontend calls this when waiting ends — returns crash_point to drive animation."""

    authentication_classes: list = []
    permission_classes: list = []

    def post(self, request: Request) -> Response:
        player = player_from_request(request)
        round_id = request.data.get('round_id')
        try:
            round_obj = services.start_round(round_id)
        except GameRound.DoesNotExist:
            return Response({'detail': 'Round not found'}, status=status.HTTP_404_NOT_FOUND)
        bets = Bet.objects.filter(player=player, round=round_obj).exclude(
            status=Bet.Status.CANCELLED
        )
        return Response(
            {
                'round': RoundSerializer(round_obj).data,
                'bets': BetSerializer(bets, many=True).data,
                'player': PlayerSerializer(player).data,
            }
        )


class CashOutView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    def post(self, request: Request) -> Response:
        ser = CashOutSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        player = player_from_request(request)
        try:
            bet = services.cash_out(
                player=player,
                panel=ser.validated_data['panel'],
                mult=ser.validated_data['mult'],
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        player.refresh_from_db()
        return Response(
            {
                'bet': BetSerializer(bet).data,
                'player': PlayerSerializer(player).data,
            }
        )


class CrashRoundView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    def post(self, request: Request) -> Response:
        player = player_from_request(request)
        round_id = request.data.get('round_id')
        try:
            round_obj = services.crash_round(round_id)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        player.refresh_from_db()
        return Response(
            {
                'round': RoundSerializer(round_obj).data,
                'history': services.latest_history(30),
                'player': PlayerSerializer(player).data,
            }
        )


class NewRoundView(APIView):
    """After crash hold — open the next waiting round."""

    authentication_classes: list = []
    permission_classes: list = []

    def post(self, request: Request) -> Response:
        player = player_from_request(request)
        flying = GameRound.objects.filter(status=GameRound.Status.FLYING).first()
        if flying:
            services.crash_round(str(flying.id))
        round_obj = services.ensure_open_round()
        data = RoundSerializer(round_obj).data
        data['crash_point'] = None
        return Response(
            {
                'round': data,
                'player': PlayerSerializer(player).data,
                'history': services.latest_history(30),
            }
        )
