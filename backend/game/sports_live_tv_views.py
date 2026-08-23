"""
Unified live TV API for all sports (Radhe Exchange feeds).

  GET /api/sports/live-tv/              all Radhe events with TV channels
  GET /api/sports/live-tv/lookup/       auto-match by match_name + sport
"""

from __future__ import annotations

import logging

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from game.radhexchange_stream import (
    get_radhe_live_tv_events,
    lookup_radhe_tv,
    resolve_radhe_stream,
    sync_radhe_live_tv,
)

logger = logging.getLogger("game")


@api_view(["GET"])
@permission_classes([AllowAny])
def sports_live_tv_list(request):
    """
    GET /api/sports/live-tv/?in_play=1

    Returns all Radhe Exchange events that have a TV channel.
    """
    in_play_only = request.query_params.get("in_play", "1") != "0"
    force = request.query_params.get("refresh", "false").lower() == "true"
    try:
        data = sync_radhe_live_tv(force=force)
        events = data.get("events") or []
        if in_play_only:
            events = [e for e in events if e.get("in_play")]
        return Response({
            "count": len(events),
            "synced_at": data.get("synced_at"),
            "events": events,
        })
    except Exception as exc:
        logger.exception("sports_live_tv_list failed")
        return Response(
            {"ok": False, "error": str(exc)},
            status=status.HTTP_502_BAD_GATEWAY,
        )


@api_view(["GET"])
@permission_classes([AllowAny])
def sports_live_tv_lookup(request):
    """
    GET /api/sports/live-tv/lookup/?match_name=...&sport=soccer&competition=...
    GET /api/sports/live-tv/lookup/?radhe_event_id=28327605

    Auto-resolve live TV for a running match.
    """
    radhe_event_id = (request.query_params.get("radhe_event_id") or "").strip()
    match_name = (request.query_params.get("match_name") or "").strip()
    sport = (request.query_params.get("sport") or "").strip().lower()
    competition = (request.query_params.get("competition") or "").strip()
    in_play_only = request.query_params.get("in_play", "1") != "0"

    relay_ip = request.META.get("HTTP_X_RELAY_IP") or None

    if radhe_event_id:
        try:
            payload = resolve_radhe_stream(radhe_event_id, relay_ip=relay_ip)
            return Response(payload)
        except Exception as exc:
            logger.exception("live_tv lookup by radhe_event_id=%s failed", radhe_event_id)
            return Response(
                {"ok": False, "error": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    if not match_name and not competition:
        return Response(
            {"ok": False, "error": "missing_match_name"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        hit = lookup_radhe_tv(
            match_name,
            sport=sport or None,
            competition=competition or None,
            in_play_only=in_play_only,
        )
    except Exception as exc:
        logger.exception("sports_live_tv_lookup failed")
        return Response(
            {"ok": False, "error": str(exc)},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    if not hit:
        return Response(
            {
                "ok": False,
                "error": "not_found",
                "message": "No live TV feed found for this match",
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    channel_id = hit.get("channel_id")
    stream = resolve_radhe_stream(
        hit["radhe_event_id"],
        relay_ip=relay_ip,
        channel_id=channel_id,
    )
    return Response({
        **stream,
        "match_score": hit.get("match_score"),
        "radhe_name": hit.get("name"),
        "sport": hit.get("sport"),
    })
