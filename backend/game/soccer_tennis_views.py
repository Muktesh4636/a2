"""
Soccer + Tennis public data APIs (same shape as cricket).

Users fetch from OUR APIs only — background worker fills Redis from DafaBet.

  GET /api/soccer/live-matches/
  GET /api/soccer/scores/
  GET /api/soccer/odds/
  GET /api/soccer/matches/
  GET /api/soccer/matches/<id>/
  GET /api/soccer/upcoming/
  GET /api/soccer/changes/
  GET /api/soccer/markets/?ids=
  GET /api/soccer/sync-status/

  GET /api/tennis/...  (same paths)
"""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from game import sports_feed as feed
from game.sports_betting import cash_out_sports_bet, my_sports_bets, place_sports_bet


def _attach_live_tv(match: dict, sport: str) -> dict:
    try:
        from game.radhexchange_stream import live_tv_for_match
        tv = live_tv_for_match(match, sport=sport, in_play_only=True)
        if tv:
            out = dict(match)
            out["live_tv"] = tv
            return out
    except Exception:
        pass
    return match


def _sport_from_path(request) -> str:
    path = (request.path or "").lower()
    if "/api/tennis/" in path:
        return "tennis"
    return "soccer"


def _keys_for(request):
    return feed._keys(_sport_from_path(request))


def _cfg_for(request):
    return feed.get_sport_config(_sport_from_path(request))


@api_view(["GET"])
@permission_classes([AllowAny])
def live_matches(request):
    sport = _sport_from_path(request)
    cfg = feed.get_sport_config(sport)
    keys = feed._keys(sport)
    no_odds = request.GET.get("no_odds", "false").lower() == "true"
    force = request.GET.get("refresh", "false").lower() == "true"

    if force:
        result = feed.fetch_and_cache_live(sport)
        if not result.get("ok"):
            return Response(
                {"error": "sync_failed", "detail": "Could not fetch from upstream."},
                status=502,
            )

    cache_key = keys["scores"] if no_odds else keys["matches"]
    matches = feed.cache_get(cache_key)
    if matches is None:
        feed.fetch_and_cache_live(sport)
        matches = feed.cache_get(cache_key) or []

    matches = [_attach_live_tv(m, sport) for m in matches]

    return Response({
        "count": len(matches),
        "sport": cfg["name"],
        "sport_id": int(cfg["path_id"]),
        "last_sync": feed.cache_get(keys["sync_ts"]),
        "matches": matches,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def scores(request):
    sport = _sport_from_path(request)
    keys = feed._keys(sport)
    matches = feed.cache_get(keys["scores"])
    if matches is None:
        feed.fetch_and_cache_live(sport)
        matches = feed.cache_get(keys["scores"]) or []
    return Response({
        "count": len(matches),
        "sport": feed.get_sport_config(sport)["name"],
        "last_sync": feed.cache_get(keys["sync_ts"]),
        "matches": matches,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def odds(request):
    sport = _sport_from_path(request)
    keys = feed._keys(sport)
    matches = feed.cache_get(keys["odds"])
    if matches is None:
        feed.fetch_and_cache_live(sport)
        matches = feed.cache_get(keys["odds"]) or []
    return Response({
        "count": len(matches),
        "sport": feed.get_sport_config(sport)["name"],
        "last_sync": feed.cache_get(keys["sync_ts"]),
        "matches": matches,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def match_list(request):
    sport = _sport_from_path(request)
    keys = feed._keys(sport)
    cfg = feed.get_sport_config(sport)
    matches = feed.cache_get(keys["scores"])
    if matches is None:
        feed.fetch_and_cache_live(sport)
        matches = feed.cache_get(keys["scores"]) or []

    listing = []
    for m in matches:
        serving_team = next((s["team"] for s in m.get("scores") or [] if s.get("serving")), None)
        listing.append({
            "id": m["id"],
            "match": m["match"],
            "competition": m.get("competition"),
            "country": m.get("country"),
            "period": m.get("period"),
            "clock": m.get("clock"),
            "scores": m.get("scores"),
            "sets": m.get("sets"),
            "serving": serving_team,
            "markets": m.get("live_market_count", 0),
            "detail_url": f"/api/{cfg['slug']}/matches/{m['id']}/",
        })

    return Response({
        "count": len(listing),
        "sport": cfg["name"],
        "last_sync": feed.cache_get(keys["sync_ts"]),
        "matches": listing,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def match_detail(request, match_id: int):
    sport = _sport_from_path(request)
    keys = feed._keys(sport)
    cfg = feed.get_sport_config(sport)
    matches = feed.cache_get(keys["matches"])
    if matches is None:
        feed.fetch_and_cache_live(sport)
        matches = feed.cache_get(keys["matches"]) or []

    match = next((m for m in matches if m.get("id") == match_id), None)
    if match is None:
        # also check upcoming
        upcoming = feed.cache_get(keys["upcoming"]) or []
        match = next((m for m in upcoming if m.get("id") == match_id), None)
        if match is None:
            return Response(
                {
                    "error": "not_found",
                    "detail": (
                        f"No live/upcoming match with id={match_id}. "
                        f"Get current ids from /api/{cfg['slug']}/matches/"
                    ),
                },
                status=status.HTTP_404_NOT_FOUND,
            )

    return Response({
        "sport": cfg["name"],
        "last_sync": feed.cache_get(keys["sync_ts"]),
        "match": _attach_live_tv(match, sport),
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def upcoming_matches(request):
    sport = _sport_from_path(request)
    keys = feed._keys(sport)
    cfg = feed.get_sport_config(sport)
    force = request.GET.get("refresh", "false").lower() == "true"
    if force:
        feed.fetch_and_cache_upcoming(sport)

    upcoming = feed.cache_get(keys["upcoming"])
    if upcoming is None:
        feed.fetch_and_cache_upcoming(sport)
        upcoming = feed.cache_get(keys["upcoming"]) or []

    return Response({
        "count": len(upcoming),
        "sport": cfg["name"],
        "last_sync": feed.cache_get(keys["sync_ts"]),
        "matches": upcoming,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def live_changes(request):
    sport = _sport_from_path(request)
    keys = feed._keys(sport)
    matches = feed.cache_get(keys["matches"])
    if matches is None:
        feed.fetch_and_cache_live(sport)
        matches = feed.cache_get(keys["matches"]) or []

    changes = []
    for m in matches or []:
        eid = m.get("id")
        for market in (m.get("odds") or {}).get("markets") or []:
            mid = market.get("id")
            for outcome in market.get("outcomes") or []:
                changes.append({
                    "outcome_id": outcome.get("id"),
                    "event_id": eid,
                    "market_id": mid,
                    "price_decimal": outcome.get("price_decimal"),
                    "price_formatted": outcome.get("price_formatted"),
                    "hidden": outcome.get("hidden", False),
                })

    return Response({
        "sport": feed.get_sport_config(sport)["name"],
        "next_bn": feed.cache_get(keys["sync_bn"]),
        "last_sync": feed.cache_get(keys["sync_ts"]),
        "change_count": len(changes),
        "changes": changes,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def markets(request):
    ids = (request.GET.get("ids") or "").strip()
    if not ids:
        return Response(
            {"error": "missing_param", "detail": "Provide ?ids=id1,id2,..."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    data, err = feed.fetch_upstream(
        f"{feed._BASE}/markets/{ids}",
        {"includePrices": "true", "l": "en-GB"},
    )
    if err or data is None:
        return Response(
            {"error": "upstream_unavailable", "detail": "Market data temporarily unavailable."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    markets_raw = data if isinstance(data, list) else []
    simplified = []
    for m in markets_raw:
        outcomes = []
        for o in m.get("outcomes", []):
            cp = (o.get("consolidatedPrice") or {}).get("currentPrice") or {}
            pp = (o.get("consolidatedPrice") or {}).get("penultimatePrice") or {}
            outcomes.append({
                "id": o.get("id"),
                "description": o.get("description"),
                "price_decimal": cp.get("decimal"),
                "price_formatted": cp.get("format"),
                "prev_price_decimal": pp.get("decimal") or None,
                "line": o.get("extraKey1"),
                "withdrawn": o.get("withdrawn", False),
            })
        simplified.append({
            "id": m.get("id"),
            "description": m.get("description"),
            "market_type": (m.get("marketTypeInfo") or {}).get("description", ""),
            "status": m.get("status"),
            "event_id": m.get("eventId"),
            "period": (m.get("period") or {}).get("fullDescription", ""),
            "outcomes": outcomes,
        })

    return Response({"count": len(simplified), "markets": simplified})


@api_view(["GET"])
@permission_classes([AllowAny])
def sync_status(request):
    sport = _sport_from_path(request)
    keys = feed._keys(sport)
    cfg = feed.get_sport_config(sport)
    last_sync = feed.cache_get(keys["sync_ts"])
    matches = feed.cache_get(keys["matches"]) or []
    sync_bn = feed.cache_get(keys["sync_bn"])

    total_markets = sum(m.get("odds", {}).get("market_count", 0) for m in matches)
    worker_alive = False
    if last_sync:
        try:
            from django.utils import timezone
            sync_dt = timezone.datetime.fromisoformat(last_sync)
            if timezone.is_naive(sync_dt):
                sync_dt = timezone.make_aware(sync_dt)
            worker_alive = (timezone.now() - sync_dt).total_seconds() < 45
        except Exception:
            pass

    return Response({
        "sport": cfg["name"],
        "sport_id": int(cfg["path_id"]),
        "worker_alive": worker_alive,
        "last_sync": last_sync,
        "cached_matches": len(matches),
        "cached_markets": total_markets,
        "last_batch_number": sync_bn,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def place_bet(request):
    return place_sports_bet(request, _sport_from_path(request))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_bets(request):
    return my_sports_bets(request, _sport_from_path(request))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cash_out_bet(request, bet_id: int):
    return cash_out_sports_bet(request, _sport_from_path(request), bet_id)
