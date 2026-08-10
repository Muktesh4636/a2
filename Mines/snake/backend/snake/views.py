from decimal import Decimal, InvalidOperation

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Game
from .services import get_or_create_player, play_round, serialize_game, serialize_track


def player_from_request(request: Request):
    player_id = request.headers.get('X-Player-Id') or request.data.get('player_id')
    return get_or_create_player(player_id)


class PlayerMeView(APIView):
    def get(self, request: Request) -> Response:
        player = player_from_request(request)
        last = (
            Game.objects.filter(player=player)
            .order_by('-created_at')
            .first()
        )
        return Response(serialize_game(last, player))


class TrackView(APIView):
    def get(self, request: Request) -> Response:
        return Response({'track': serialize_track()})


class PlayView(APIView):
    def post(self, request: Request) -> Response:
        player = player_from_request(request)
        try:
            bet_amount = Decimal(str(request.data.get('bet_amount', '0')))
        except (InvalidOperation, TypeError, ValueError):
            return Response(
                {'detail': 'Invalid bet_amount.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        game = play_round(player, bet_amount)
        game.player.refresh_from_db()
        return Response(serialize_game(game, game.player), status=status.HTTP_201_CREATED)
