"""
Trading API — real Gundu accounts only (JWT + Wallet).
No guest / demo sessions.
"""

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from accounts.models import Wallet
from game import trading_services as services
from game.trading_services import GameError


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def trading_me(request):
    """GET /api/trading/me/ — wallet + pending position + shared clock."""
    if not Wallet.objects.filter(user=request.user).exists():
        return Response({"detail": "wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    from game import trading_engine as engine

    payload = services.user_payload(request.user)
    payload["game"] = engine.public_state(request.user)
    return Response(payload)


@api_view(["GET"])
@permission_classes([AllowAny])
def trading_state(request):
    """GET /api/trading/state/ — shared clock (public) + user wallet if authenticated."""
    from game import trading_engine as engine

    user = request.user if request.user.is_authenticated else None
    payload = engine.public_state(user)
    if user is not None and Wallet.objects.filter(user=user).exists():
        payload.update(services.user_payload(user))
    return Response(payload)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def trading_place_bet(request):
    """POST /api/trading/bets/  body: {side, amount}"""
    try:
        amount = int(request.data.get("amount"))
    except (TypeError, ValueError):
        return Response({"detail": "amount must be an integer"}, status=status.HTTP_400_BAD_REQUEST)
    side = request.data.get("side")
    try:
        services.place_bet(request.user, side, amount)
    except GameError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    from game import trading_engine as engine

    payload = services.user_payload(request.user)
    payload["game"] = engine.public_state(request.user)
    return Response(payload, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def trading_undo(request):
    try:
        services.undo_bet(request.user)
    except GameError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    from game import trading_engine as engine

    payload = services.user_payload(request.user)
    payload["game"] = engine.public_state(request.user)
    return Response(payload)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def trading_cashout(request):
    try:
        result = services.cashout(request.user)
    except GameError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    from game import trading_engine as engine

    payload = services.user_payload(request.user)
    payload["game"] = engine.public_state(request.user)
    payload.update(result)
    return Response(payload)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def trading_history(request):
    try:
        limit = int(request.query_params.get("limit", 20))
    except (TypeError, ValueError):
        limit = 20
    return Response(services.history(request.user, limit=limit))
