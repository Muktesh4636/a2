from decimal import Decimal, InvalidOperation

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Game
from .services import (
    cash_out,
    get_or_create_player,
    reveal_tile,
    serialize_game,
    start_game,
)


def player_from_request(request: Request):
    player_id = request.headers.get('X-Player-Id') or request.data.get('player_id')
    return get_or_create_player(player_id)


class PlayerMeView(APIView):
    """Create or fetch a player wallet."""

    def get(self, request: Request) -> Response:
        player = player_from_request(request)
        active = (
            Game.objects.filter(player=player, status=Game.Status.PLAYING)
            .order_by('-created_at')
            .first()
        )
        payload = {
            'player_id': str(player.id),
            'balance': str(player.balance),
            'active_game': serialize_game(active, player) if active else None,
        }
        return Response(payload)


class GameStartView(APIView):
    """Place a bet and start a new Mines round."""

    def post(self, request: Request) -> Response:
        player = player_from_request(request)

        try:
            bet_amount = Decimal(str(request.data.get('bet_amount', '0')))
            mine_count = int(request.data.get('mine_count', 3))
        except (InvalidOperation, TypeError, ValueError):
            return Response(
                {'detail': 'Invalid bet_amount or mine_count.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        game = start_game(player, bet_amount, mine_count)
        game.player.refresh_from_db()
        return Response(serialize_game(game), status=status.HTTP_201_CREATED)


class GameDetailView(APIView):
    def get(self, request: Request, game_id) -> Response:
        player = player_from_request(request)
        game = get_object_or_404(Game, id=game_id, player=player)
        return Response(serialize_game(game, player))


class GameRevealView(APIView):
    def post(self, request: Request, game_id) -> Response:
        player = player_from_request(request)
        game = get_object_or_404(Game, id=game_id, player=player)

        try:
            index = int(request.data.get('index'))
        except (TypeError, ValueError):
            return Response(
                {'detail': 'index is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        game = reveal_tile(game, index)
        game.player.refresh_from_db()
        return Response(serialize_game(game))


class GameCashOutView(APIView):
    def post(self, request: Request, game_id) -> Response:
        player = player_from_request(request)
        game = get_object_or_404(Game, id=game_id, player=player)
        game = cash_out(game)
        game.player.refresh_from_db()
        return Response(serialize_game(game))
