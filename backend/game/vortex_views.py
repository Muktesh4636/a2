"""Vortex API — JWT + Gundu Wallet."""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from accounts.models import Wallet
from game import vortex_engine as engine


def _ensure_wallet(user):
    if not Wallet.objects.filter(user=user).exists():
        Wallet.objects.create(user=user, balance=0)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def vortex_state(request):
    _ensure_wallet(request.user)
    try:
        data = engine.get_state(request.user)
    except Wallet.DoesNotExist:
        return Response({"detail": "Wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    except engine.GameError as exc:
        return Response({"detail": exc.message, "ok": False, "error": exc.message}, status=exc.status)
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def vortex_bet(request):
    _ensure_wallet(request.user)
    try:
        data = engine.set_bet(request.user, request.data.get("bet"))
    except Wallet.DoesNotExist:
        return Response({"detail": "Wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    except engine.GameError as exc:
        return Response({"detail": exc.message, "ok": False, "error": exc.message}, status=exc.status)
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def vortex_spin(request):
    _ensure_wallet(request.user)
    try:
        data = engine.spin(request.user)
    except Wallet.DoesNotExist:
        return Response({"detail": "Wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    except engine.GameError as exc:
        return Response({"detail": exc.message, "ok": False, "error": exc.message}, status=exc.status)
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def vortex_cashout(request):
    _ensure_wallet(request.user)
    try:
        data = engine.cashout(request.user)
    except Wallet.DoesNotExist:
        return Response({"detail": "Wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    except engine.GameError as exc:
        return Response({"detail": exc.message, "ok": False, "error": exc.message}, status=exc.status)
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def vortex_part(request):
    _ensure_wallet(request.user)
    try:
        data = engine.part(request.user)
    except Wallet.DoesNotExist:
        return Response({"detail": "Wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    except engine.GameError as exc:
        return Response({"detail": exc.message, "ok": False, "error": exc.message}, status=exc.status)
    return Response(data)
