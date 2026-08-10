from decimal import Decimal, InvalidOperation

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Game
from .services import (
    ensure_selecting_game,
    get_or_create_player,
    new_round,
    place_bet,
    serialize_game,
    toggle_select,
)


def player_from_request(request: Request):
    player_id = request.headers.get('X-Player-Id') or request.data.get('player_id')
    return get_or_create_player(player_id)


class PlayerMeView(APIView):
    def get(self, request: Request) -> Response:
        player = player_from_request(request)
        game = ensure_selecting_game(player)
        return Response(
            {
                'player_id': str(player.id),
                'balance': str(player.balance),
                'active_game': serialize_game(game, player),
            }
        )


class GameSelectView(APIView):
    def post(self, request: Request) -> Response:
        player = player_from_request(request)
        game = ensure_selecting_game(player)
        try:
            index = int(request.data.get('index'))
        except (TypeError, ValueError):
            return Response(
                {'detail': 'index is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        game = toggle_select(game, index)
        game.player.refresh_from_db()
        return Response(serialize_game(game))


class GameBetView(APIView):
    def post(self, request: Request) -> Response:
        player = player_from_request(request)
        game = ensure_selecting_game(player)
        try:
            bet_amount = Decimal(str(request.data.get('bet_amount', '0')))
        except (InvalidOperation, TypeError, ValueError):
            return Response(
                {'detail': 'Invalid bet_amount.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        settled = place_bet(game, bet_amount)
        settled.player.refresh_from_db()
        return Response(serialize_game(settled))


class GameNewView(APIView):
    def post(self, request: Request) -> Response:
        player = player_from_request(request)
        game = new_round(player)
        return Response(serialize_game(game, player), status=status.HTTP_201_CREATED)


class GameDetailView(APIView):
    def get(self, request: Request, game_id) -> Response:
        player = player_from_request(request)
        game = get_object_or_404(Game, id=game_id, player=player)
        return Response(serialize_game(game, player))
