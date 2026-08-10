from decimal import Decimal, InvalidOperation

from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Game
from .services import get_or_create_player, play_round, serialize_game, serialize_pool


def player_from_request(request: Request):
    return get_or_create_player(request.headers.get('X-Player-Id'))


class PlayerMeView(APIView):
    def get(self, request: Request) -> Response:
        player = player_from_request(request)
        latest = (
            Game.objects.filter(player=player).order_by('-created_at').first()
        )
        return Response(serialize_game(latest, player))


class PoolView(APIView):
    def get(self, request: Request) -> Response:
        return Response({'pool': serialize_pool()})


class PlayView(APIView):
    def post(self, request: Request) -> Response:
        player = player_from_request(request)
        raw = request.data.get('bet_amount')
        try:
            bet = Decimal(str(raw))
        except (InvalidOperation, TypeError, ValueError):
            return Response({'bet_amount': ['Invalid bet amount.']}, status=400)

        game = play_round(player, bet)
        player.refresh_from_db()
        return Response(serialize_game(game, player))
