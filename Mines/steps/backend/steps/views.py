from decimal import Decimal, InvalidOperation

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Game
from .services import (
    cash_out,
    choose_step,
    get_or_create_player,
    serialize_game,
    start_game,
)


def player_from_request(request: Request):
    player_id = request.headers.get('X-Player-Id') or request.data.get('player_id')
    return get_or_create_player(player_id)


class PlayerMeView(APIView):
    def get(self, request: Request) -> Response:
        player = player_from_request(request)
        active = (
            Game.objects.filter(player=player, status=Game.Status.PLAYING)
            .order_by('-created_at')
            .first()
        )
        return Response(
            {
                'player_id': str(player.id),
                'balance': str(player.balance),
                'active_game': serialize_game(active, player) if active else None,
            }
        )


class GameStartView(APIView):
    def post(self, request: Request) -> Response:
        player = player_from_request(request)
        try:
            bet_amount = Decimal(str(request.data.get('bet_amount', '0')))
        except (InvalidOperation, TypeError, ValueError):
            return Response(
                {'detail': 'Invalid bet_amount.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        game = start_game(player, bet_amount)
        game.player.refresh_from_db()
        return Response(serialize_game(game), status=status.HTTP_201_CREATED)


class GameDetailView(APIView):
    def get(self, request: Request, game_id) -> Response:
        player = player_from_request(request)
        game = get_object_or_404(Game, id=game_id, player=player)
        return Response(serialize_game(game, player))


class GameChooseView(APIView):
    def post(self, request: Request, game_id) -> Response:
        player = player_from_request(request)
        game = get_object_or_404(Game, id=game_id, player=player)

        try:
            column = int(request.data.get('column'))
        except (TypeError, ValueError):
            return Response(
                {'detail': 'column is required (0, 1, or 2).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        game = choose_step(game, column)
        game.player.refresh_from_db()
        return Response(serialize_game(game))


class GameCashOutView(APIView):
    def post(self, request: Request, game_id) -> Response:
        player = player_from_request(request)
        game = get_object_or_404(Game, id=game_id, player=player)
        game = cash_out(game)
        game.player.refresh_from_db()
        return Response(serialize_game(game))
