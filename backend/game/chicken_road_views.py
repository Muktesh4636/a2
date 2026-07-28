"""Chicken Road (v1) API — JWT + Gundu Wallet."""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status

from accounts.models import Wallet
from game import chicken_road_engine as engine


def _ensure_wallet(user):
    if not Wallet.objects.filter(user=user).exists():
        Wallet.objects.create(user=user, balance=0)


@api_view(["GET"])
@permission_classes([AllowAny])
def chicken_road_config(request):
    return Response(engine.game_config())


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def chicken_road_me(request):
    _ensure_wallet(request.user)
    bal = int(Wallet.objects.get(user=request.user).balance)
    active = engine.active_round_for(request.user)
    return Response({
        "balance": bal,
        "username": request.user.username,
        "user_id": request.user.id,
        "active_round": engine.public_state(active, balance=bal) if active else None,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chicken_road_start(request):
    _ensure_wallet(request.user)
    try:
        state = engine.start_round(
            request.user,
            bet=request.data.get("bet"),
            difficulty=request.data.get("difficulty", "easy"),
        )
    except engine.GameError as exc:
        return Response({"detail": exc.message}, status=exc.status)
    except Wallet.DoesNotExist:
        return Response({"detail": "Wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    return Response(state, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chicken_road_go(request, round_id):
    try:
        state = engine.apply_go(round_id, request.user)
    except engine.GameError as exc:
        return Response({"detail": exc.message}, status=exc.status)
    return Response(state)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chicken_road_cashout(request, round_id):
    try:
        state = engine.apply_cashout(round_id, request.user)
    except engine.GameError as exc:
        return Response({"detail": exc.message}, status=exc.status)
    return Response(state)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def chicken_road_round(request, round_id):
    from game.models import ChickenRoadRound

    round_obj = ChickenRoadRound.objects.filter(pk=round_id, user=request.user).first()
    if not round_obj:
        return Response({"detail": "Round not found"}, status=status.HTTP_404_NOT_FOUND)
    bal = int(Wallet.objects.get(user=request.user).balance)
    return Response(engine.public_state(round_obj, balance=bal))
