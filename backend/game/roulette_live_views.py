"""Evolution auto-roulette live HLS relay API."""

import os

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

ROULETTE_LIVE_HLS_BASE = os.environ.get(
    "ROULETTE_LIVE_HLS_BASE", "https://gunduata.tech/roulette-live"
).rstrip("/")


@api_view(["GET"])
@permission_classes([AllowAny])
def roulette_live_stream(request):
    """
    GET /api/roulette/live-stream/

    Returns our relayed Evolution auto-roulette HLS URL.
    """
    return Response(
        {
            "ok": True,
            "game": "auto-roulette-13",
            "provider": "evolution",
            "hls_url": f"{ROULETTE_LIVE_HLS_BASE}/auto-roulette/stream.m3u8",
            "poster": "/casino/images/auto-roulette.png",
        }
    )


def roulette_live_ui(request):
    from django.shortcuts import render
    return render(request, "roulette/live.html")
