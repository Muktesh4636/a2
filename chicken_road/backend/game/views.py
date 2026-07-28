import random
import uuid

from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from game import engine
from game.models import GameRound, Player
from game.serializers import PlayerSerializer, StartGameSerializer

PLAYER_HEADER = 'HTTP_X_PLAYER_ID'

FAKE_USERS = [
    {'user': 'WorthOtter45', 'flag': 'ca'},
    {'user': '29545666--7b', 'flag': 'in'},
    {'user': 'LuckyFox99', 'flag': 'us'},
    {'user': 'ProGamer22', 'flag': 'br'},
    {'user': 'egg***88', 'flag': 'in'},
    {'user': 'Kimmstarr', 'flag': 'nl'},
    {'user': '62NiftyStint', 'flag': 'gb'},
    {'user': '26286699--27e', 'flag': 'in'},
    {'user': 'RajaWin***', 'flag': 'in'},
    {'user': 'NightOwl_7', 'flag': 'de'},
    {'user': 'SpinKing21', 'flag': 'ph'},
    {'user': 'mystic***9', 'flag': 'us'},
    {'user': 'ApexHunter', 'flag': 'au'},
    {'user': 'bet***404', 'flag': 'ng'},
    {'user': 'GoldenEgg88', 'flag': 'in'},
    {'user': 'FoxTrail12', 'flag': 'ca'},
    {'user': 'lucky***x', 'flag': 'bd'},
    {'user': 'TurboDash', 'flag': 'br'},
    {'user': 'neon_piper', 'flag': 'jp'},
    {'user': 'CashCow99', 'flag': 'za'},
    {'user': '7b--884512', 'flag': 'in'},
    {'user': 'SkyRocket', 'flag': 'mx'},
    {'user': 'play***77', 'flag': 'pk'},
    {'user': 'NovaBlast', 'flag': 'fr'},
]

AVATAR_COLORS = [
    '#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400',
    '#16a085', '#c0398b', '#2c3e50', '#e67e22', '#1abc9c',
]


def get_player(request) -> Player | None:
    raw = request.META.get(PLAYER_HEADER) or request.headers.get('X-Player-Id')
    if not raw:
        return None
    try:
        return Player.objects.get(pk=uuid.UUID(str(raw)))
    except (Player.DoesNotExist, ValueError, TypeError):
        return None


def require_player(request):
    player = get_player(request)
    if player is None:
        return None, Response(
            {'detail': 'Missing or invalid X-Player-Id header.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    return player, None


class PlayerCreateView(APIView):
    """POST /api/player/ — create guest player (or return existing if header set)."""

    def post(self, request):
        existing = get_player(request)
        if existing:
            return Response(PlayerSerializer(existing).data)
        starting = engine.money(getattr(settings, 'GAME_STARTING_BALANCE', '1000.00'))
        player = Player.objects.create(balance=starting)
        return Response(PlayerSerializer(player).data, status=status.HTTP_201_CREATED)


class PlayerMeView(APIView):
    """GET /api/player/me/"""

    def get(self, request):
        player, err = require_player(request)
        if err:
            return err
        return Response(PlayerSerializer(player).data)


class ConfigView(APIView):
    """GET /api/config/"""

    def get(self, request):
        return Response(engine.game_config())


class GameStartView(APIView):
    """POST /api/game/start/"""

    def post(self, request):
        player, err = require_player(request)
        if err:
            return err
        ser = StartGameSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            state = engine.start_round(
                player,
                bet=ser.validated_data['bet'],
                difficulty=ser.validated_data['difficulty'],
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(state, status=status.HTTP_201_CREATED)


class GameDetailView(APIView):
    """GET /api/game/{id}/"""

    def get(self, request, round_id):
        player, err = require_player(request)
        if err:
            return err
        try:
            round_obj = GameRound.objects.get(pk=round_id, player=player)
        except GameRound.DoesNotExist:
            return Response({'detail': 'Round not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(engine.public_state(round_obj, balance=player.balance))


class GameGoView(APIView):
    """POST /api/game/{id}/go/"""

    def post(self, request, round_id):
        player, err = require_player(request)
        if err:
            return err
        try:
            round_obj = GameRound.objects.get(pk=round_id, player=player)
        except GameRound.DoesNotExist:
            return Response({'detail': 'Round not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            state = engine.apply_go(round_obj)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(state)


class GameCashoutView(APIView):
    """POST /api/game/{id}/cashout/"""

    def post(self, request, round_id):
        player, err = require_player(request)
        if err:
            return err
        try:
            round_obj = GameRound.objects.get(pk=round_id, player=player)
        except GameRound.DoesNotExist:
            return Response({'detail': 'Round not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            state = engine.apply_cashout(round_obj)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(state)


class LiveWinsView(APIView):
    """GET /api/live/ — fake live wins feed."""

    def get(self, request):
        u = random.choice(FAKE_USERS)
        letter = (''.join(ch for ch in u['user'] if ch.isalpha()) or 'P')[0].upper()
        roll = random.random()
        if roll < 0.55:
            amount = round(random.random() * 80 + 5, 2)
        elif roll < 0.85:
            amount = round(random.random() * 400 + 80, 2)
        else:
            amount = round(random.random() * 2000 + 400, 2)
        return Response({
            'user': u['user'],
            'flag': u['flag'],
            'letter': letter,
            'color': random.choice(AVATAR_COLORS),
            'amount': amount,
            'online': random.randint(900, 1800),
            'id': f'{uuid.uuid4().hex[:12]}',
        })
