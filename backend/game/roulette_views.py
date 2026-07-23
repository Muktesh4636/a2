"""
Roulette API — real Gundu accounts only (JWT + Wallet).
No guest / demo sessions.
"""

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import Wallet
from game import roulette_services as services
from game.roulette_services import GameError


def _key_from_body(data) -> str:
    key = data.get("key")
    if key:
        return str(key)
    bet_type = data.get("type")
    if not bet_type:
        raise GameError("provide key or type")
    value = data.get("value") or ""
    return f"{bet_type}:{value}" if value else str(bet_type)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def roulette_me(request):
    """GET /api/roulette/me/ — real wallet balance + pending bets."""
    if not Wallet.objects.filter(user=request.user).exists():
        return Response({"detail": "wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    return Response(services.user_payload(request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def roulette_place_bet(request):
    """POST /api/roulette/bets/  body: {key, amount}"""
    try:
        amount = int(request.data.get("amount"))
    except (TypeError, ValueError):
        return Response({"detail": "amount must be an integer"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        if not Wallet.objects.filter(user=request.user).exists():
            return Response({"detail": "wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
        key = _key_from_body(request.data)
        services.place_bet(request.user, key, amount)
    except GameError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(services.user_payload(request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def roulette_undo(request):
    try:
        services.undo_bet(request.user)
    except GameError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(services.user_payload(request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def roulette_double(request):
    try:
        services.double_bets(request.user)
    except GameError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(services.user_payload(request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def roulette_clear(request):
    try:
        services.clear_bets(request.user)
    except GameError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(services.user_payload(request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def roulette_spin(request):
    """POST /api/roulette/spin/ — server rolls 0–36 and settles against wallet."""
    try:
        result = services.spin(request.user)
    except GameError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(
        {
            "number": result.number,
            "win": result.win,
            "balance": result.balance,
            "stake": result.total_stake,
            "round_id": result.round_id,
            "winning_keys": result.winning_keys,
            "pending_bets": [],
            "total_bet": 0,
            "history": services.history(request.user, limit=10),
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def roulette_history(request):
    try:
        limit = int(request.query_params.get("limit", 20))
    except (TypeError, ValueError):
        limit = 20
    return Response({"results": services.history(request.user, limit=limit)})
