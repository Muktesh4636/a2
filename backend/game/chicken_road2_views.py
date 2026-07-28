"""Chicken Road 2 API — JWT + Gundu Wallet."""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status

from accounts.models import Wallet
from game import chicken_road2_engine as engine


def _ensure_wallet(user):
    if not Wallet.objects.filter(user=user).exists():
        Wallet.objects.create(user=user, balance=0)


@api_view(["GET"])
@permission_classes([AllowAny])
def chicken_road2_config(request):
    return Response(engine.game_config())


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def chicken_road2_me(request):
    _ensure_wallet(request.user)
    bal = int(Wallet.objects.get(user=request.user).balance)
    active = engine.active_round_for(request.user)
    return Response({
        "balance": bal,
        "username": request.user.username,
        "user_id": request.user.id,
        "active_round": engine.public_round(active) if active else None,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chicken_road2_start(request):
    _ensure_wallet(request.user)
    try:
        data = engine.start_round(
            request.user,
            bet=request.data.get("bet"),
            difficulty=request.data.get("difficulty", "easy"),
            client_seed=request.data.get("client_seed", ""),
        )
    except engine.GameError as exc:
        return Response({"detail": exc.message}, status=exc.status)
    except Wallet.DoesNotExist:
        return Response({"detail": "Wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chicken_road2_step(request, round_id):
    try:
        data = engine.step_round(request.user, round_id)
    except engine.GameError as exc:
        return Response({"detail": exc.message}, status=exc.status)
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chicken_road2_cashout(request, round_id):
    try:
        data = engine.cash_out(request.user, round_id)
    except engine.GameError as exc:
        return Response({"detail": exc.message}, status=exc.status)
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chicken_road2_forfeit(request, round_id):
    try:
        data = engine.forfeit_round(request.user, round_id)
    except engine.GameError as exc:
        return Response({"detail": exc.message}, status=exc.status)
    return Response(data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def chicken_road2_round(request, round_id):
    from game.models import ChickenRoad2Round

    round_obj = ChickenRoad2Round.objects.filter(pk=round_id, user=request.user).first()
    if not round_obj:
        return Response({"detail": "Round not found"}, status=status.HTTP_404_NOT_FOUND)
    return Response(engine.public_round(round_obj))
