"""
Roulette API — real Gundu accounts only (JWT + Wallet).
No guest / demo sessions.
"""

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
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
    """GET /api/roulette/me/ — real wallet balance + pending bets + shared clock."""
    if not Wallet.objects.filter(user=request.user).exists():
        return Response({"detail": "wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    from game import roulette_engine as engine

    payload = services.user_payload(request.user)
    payload["game"] = engine.public_state(request.user)
    return Response(payload)


@api_view(["GET"])
@permission_classes([AllowAny])
def roulette_state(request):
    """GET /api/roulette/state/ — shared phase clock (public) + user wallet if authenticated."""
    from game import roulette_engine as engine

    user = request.user if request.user.is_authenticated else None
    payload = engine.public_state(user)
    if user is not None and Wallet.objects.filter(user=user).exists():
        payload.update(services.user_payload(user))
    return Response(payload)


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
    """
    POST /api/roulette/spin/ — deprecated for clients (shared auto-spin).
    Returns current shared game state instead of rolling a private number.
    """
    from game import roulette_engine as engine

    if not Wallet.objects.filter(user=request.user).exists():
        return Response({"detail": "wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    st = engine.public_state(request.user)
    payload = services.user_payload(request.user)
    return Response(
        {
            **payload,
            "game": st,
            "number": st.get("number") if st.get("phase") in ("spinning", "result") else st.get("last_number"),
            "win": st.get("win") or 0,
            "auto": True,
            "detail": "spins are automatic — shared round for all users",
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
