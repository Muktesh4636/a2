"""
Cricket Live Data APIs
======================
Data is pulled from the Dafabet sports feed by a background worker
(management command: sync_cricket_data) every 5 seconds and stored in Redis.

All endpoints below read from Redis cache — they are fast and never
block on an external HTTP call at request time.

If Redis is cold (worker not running or first boot) the endpoints fall
back to a direct proxy call so they always return data.

Redis keys
----------
  cricket:matches      — full match list with scores + odds  (TTL 30 s)
  cricket:scores       — score-only list                     (TTL 30 s)
  cricket:odds         — odds-only list                      (TTL 30 s)
  cricket:last_sync    — ISO timestamp of last successful sync
  cricket:sync_bn      — last batch-number used for changes polling

Endpoints
---------
  GET /api/cricket/live-matches/      scores + all odds
  GET /api/cricket/scores/            scores only (fast widget)
  GET /api/cricket/odds/              odds grouped by match / by type
  GET /api/cricket/changes/           real-time delta polling (?bn=N)
  GET /api/cricket/markets/           odds for specific IDs (?ids=…)
  GET /api/cricket/all-live-events/   sport-level event counts
  GET /api/cricket/sync-status/       health — when was last sync, how many matches
"""

import json
import logging
import time

import requests

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

logger = logging.getLogger("game")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_BASE = "https://sports.nowdafa.com/xapi/rest"

_HEADERS = {
    "Accept": "application/json",
    "X-Accept-Language": "en-GB",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}

_CRICKET_MARKET_TYPE_IDS = (
    "22,24,25,76,622,130069,130079,130081,"
    "130080,130082,"   # over odd/even + per-delivery markets (gives ball-level precision)
    "145136,145142,145145,10112523,"
    "20670747,20670748,40671455,40671613"
)
_CRICKET_PERIOD_TYPE_IDS = "257,258,100258"
_CRICKET_PATH_ID = "215"

# Redis key names
REDIS_KEY_MATCHES  = "cricket:matches"
REDIS_KEY_SCORES   = "cricket:scores"
REDIS_KEY_ODDS     = "cricket:odds"
REDIS_KEY_UPCOMING = "cricket:upcoming"
REDIS_KEY_SYNC_TS  = "cricket:last_sync"
REDIS_KEY_SYNC_BN  = "cricket:sync_bn"
REDIS_TTL = 5   # seconds before cache is considered stale (worker refreshes every 1s)


# ---------------------------------------------------------------------------
# Redis helpers
# ---------------------------------------------------------------------------

def _redis():
    """Return a Redis client (reuses the app-wide pool from settings)."""
    try:
        from game.utils import get_redis_client
        return get_redis_client()
    except Exception:
        return None


def _cache_get(key: str):
    """Read a JSON-encoded value from Redis. Returns None on miss/error."""
    try:
        r = _redis()
        if r is None:
            return None
        raw = r.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.warning("cricket cache read error [%s]: %s", key, exc)
        return None


def _cache_set(key: str, value, ttl: int = REDIS_TTL):
    """Write a JSON-encoded value to Redis with TTL."""
    try:
        r = _redis()
        if r is None:
            return
        r.setex(key, ttl, json.dumps(value, default=str))
    except Exception as exc:
        logger.warning("cricket cache write error [%s]: %s", key, exc)


# ---------------------------------------------------------------------------
# Upstream fetch helpers
# ---------------------------------------------------------------------------

def _fetch(url: str, params: dict | None = None, timeout: int = 12):
    """GET with error handling. Returns (json_data, None) or (None, Response)."""
    try:
        resp = requests.get(url, headers=_HEADERS, params=params, timeout=timeout)
        resp.raise_for_status()
        return resp.json(), None
    except requests.exceptions.Timeout:
        logger.warning("Cricket upstream timeout: %s", url)
        return None, Response(
            {"error": "upstream_timeout", "detail": "Data source timed out."},
            status=status.HTTP_504_GATEWAY_TIMEOUT,
        )
    except requests.exceptions.HTTPError as exc:
        logger.warning("Cricket upstream HTTP %s: %s", exc.response.status_code, url)
        return None, Response(
            {"error": "upstream_error", "detail": str(exc)},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    except Exception as exc:
        logger.exception("Cricket upstream error: %s", exc)
        return None, Response(
            {"error": "proxy_error", "detail": str(exc)},
            status=status.HTTP_502_BAD_GATEWAY,
        )


# ---------------------------------------------------------------------------
# Ball result code → human-readable label
# ---------------------------------------------------------------------------

_BALL_CODES = {
    0: "dot",     1: "1",      2: "2",      3: "3",
    4: "4",       5: "5",      6: "6",      7: "W",
    8: "W+1",     9: "wide",   10: "nb",    11: "nb+1",
    12: "nb+2",   13: "nb+3",  14: "nb+4",  15: "wide",
    16: "bye",    17: "lb",
}


def _parse_cricket_outcomes(
    co: dict | None,
    markets: list,
    opponents: dict,
    batting_team: str | None = None,
    clock_status: str | None = None,
) -> dict | None:
    """
    Parse the `cricketOutcomes` field (when present) and market descriptions
    to produce a clean over/ball summary.

    Returns a dict with:
      current_over        — over number currently being bowled (1-based)
      current_ball        — legal deliveries bowled so far this over (0-5)
      last_ball_timestamp — epoch-ms of the last ball bowled
      recent_overs        — last N overs ball-by-ball (human-readable codes)
      current_over_balls  — balls bowled in the current over (human-readable)
    """
    import re

    # Don't infer over data during innings breaks (clock PAUSED between innings)
    if clock_status == "PAUSED" and not co:
        return None

    # Ball codes that are NOT legal deliveries (wides, no-balls, no-ball wickets)
    # Code 8 = W+1 (wicket on a no-ball free-hit) — not a legal delivery
    _EXTRAS = {8, 9, 10, 11, 12, 13, 14, 15}

    def _is_complete(balls: list) -> bool:
        """An over is complete when 6 legal deliveries have been bowled."""
        return sum(1 for b in balls if b not in _EXTRAS) >= 6

    result: dict = {}

    if co:
        from_over = co.get("fromOver", 1)
        per_ball  = co.get("perBallResults") or []
        last_ts   = co.get("lastBallTimestamp")

        if per_ball:
            last_over_balls = per_ball[-1]
            last_complete   = _is_complete(last_over_balls)

            # If the last recorded over is complete, we're between overs
            # or at the very start of the next one (current_ball = 0)
            if last_complete:
                current_over_num = from_over + len(per_ball)   # next over
                current_ball_num = 0
                current_over_raw = []
            else:
                current_over_num = from_over + len(per_ball) - 1
                legal_so_far     = [b for b in last_over_balls if b not in _EXTRAS]
                current_ball_num = len(legal_so_far)
                current_over_raw = last_over_balls

            recent_overs = []
            for i, balls in enumerate(per_ball):
                over_num      = from_over + i
                readable      = [_BALL_CODES.get(b, str(b)) for b in balls]
                runs_in_over  = sum(b for b in balls if 1 <= b <= 6)
                wkts_in_over  = sum(1 for b in balls if b == 7)
                recent_overs.append({
                    "over":     over_num,
                    "balls":    ",".join(readable),
                    "runs":     runs_in_over,
                    "wickets":  wkts_in_over,
                    "complete": _is_complete(balls),
                })

            over_balls_list = [_BALL_CODES.get(b, str(b)) for b in current_over_raw]
            result = {
                "current_over":        current_over_num,
                "current_ball":        current_ball_num,
                "current_over_balls":  ",".join(over_balls_list) if over_balls_list else None,
                "last_ball_timestamp": last_ts,
                "recent_overs":        recent_overs,
                "source":              "ball_by_ball",
            }

    # Fallback: infer current over from market descriptions.
    # Supported patterns for the CURRENT over being bowled:
    #   "Total runs for over 14 in 1st inning - TeamName"  → "for over (\d+)"
    #   "Runs in Over 6"                                    → "in Over (\d+)"
    # Ignored patterns (future milestones):
    #   "Total runs after 10 overs"
    #   "Total runs after Over 6"
    #
    # When we know the batting team, only use markets mentioning that team.
    # This prevents picking up pre-set markets for the NEXT innings
    # (e.g. "for over 1 - Zimbabwe" when Bangladesh are actually batting).
    if not result and markets:
        for_over_nums  = []
        delivery_hints = []   # (over, ball) tuples from per-delivery markets

        for m in markets:
            desc = m.get("description", "")

            # Skip markets for the non-batting team
            if batting_team:
                if " - " in desc:
                    market_team = desc.rsplit(" - ", 1)[-1].strip()
                    if market_team and market_team.lower() != batting_team.lower():
                        continue

            # "Total runs in 3rd delivery of over 15 in 1st innings - Team"
            # → gives both ball number AND over number (most precise)
            for ball_str, over_str in re.findall(
                r'in (\d+)(?:st|nd|rd|th) delivery of over (\d+)',
                desc, re.IGNORECASE
            ):
                delivery_hints.append((int(over_str), int(ball_str)))

            # "for over X" — names the over being bowled
            for n in re.findall(r'for over (\d+)', desc, re.IGNORECASE):
                for_over_nums.append(int(n))

            # "Runs in Over X" / "in over X" — but NOT "after Over X"
            for n in re.findall(r'(?<!after )\bin [Oo]ver (\d+)', desc):
                for_over_nums.append(int(n))

        if delivery_hints:
            # Pick the hint with the lowest over, then lowest ball (earliest open market)
            delivery_hints.sort()
            best_over, best_ball = delivery_hints[0]
            result = {
                "current_over":        best_over,
                "current_ball":        best_ball - 1,  # ball already bowled (market opens after)
                "current_over_balls":  None,
                "last_ball_timestamp": None,
                "recent_overs":        None,
                "source":              "delivery_inference",
            }
        elif for_over_nums:
            result = {
                "current_over":        min(for_over_nums),
                "current_ball":        None,
                "current_over_balls":  None,
                "last_ball_timestamp": None,
                "recent_overs":        None,
                "source":              "market_inference",
            }

    return result or None


# ---------------------------------------------------------------------------
# Virtual / SRL match filter
# ---------------------------------------------------------------------------

def _is_real_match(event: dict) -> bool:
    """
    Returns True only for real cricket matches (live or upcoming).
    Filters out:
      - Virtual matches  (team/match name contains "(Virtual)")
      - SRL matches      (Simulated Reality League — any path or team contains "SRL" / "Srl")
    """
    description = event.get("description", "")
    if "(Virtual)" in description:
        return False

    # Check match description itself for " Srl" (e.g. "Hobart Hurricanes Srl vs ...")
    if " Srl " in description or description.endswith(" Srl"):
        return False

    # Check all event paths (Tournament, League, Category, Country)
    paths = event.get("eventPaths", [])
    for p in paths:
        pdesc = p.get("description", "")
        if "SRL" in pdesc or "Srl" in pdesc or "Simulated Reality" in pdesc:
            return False

    # Guard against team-level SRL naming (e.g. "Central Districts Srl")
    for opp in event.get("opponents", []):
        if opp.get("description", "").endswith(" Srl"):
            return False

    return True


# ---------------------------------------------------------------------------
# Data transformation helpers
# ---------------------------------------------------------------------------

def _simplify_outcome(outcome: dict) -> dict:
    cp = (outcome.get("consolidatedPrice") or {}).get("currentPrice") or {}
    pp = (outcome.get("consolidatedPrice") or {}).get("penultimatePrice") or {}
    return {
        "id": outcome.get("id"),
        "description": outcome.get("description"),
        "price_decimal": cp.get("decimal"),
        "price_formatted": cp.get("format"),
        "prev_price_decimal": pp.get("decimal") or None,
        "line": outcome.get("extraKey1"),
        "withdrawn": outcome.get("withdrawn", False),
        "hidden": outcome.get("hidden", False),
    }


def _simplify_market(market: dict, opponent_map: dict) -> dict:
    mti = market.get("marketTypeInfo") or {}
    period = market.get("period") or {}
    opp_id = market.get("opponentId")
    team_name = opponent_map.get(opp_id, market.get("teamName", "")) if opp_id else ""
    outcomes = [
        _simplify_outcome(o)
        for o in market.get("outcomes", [])
        if not o.get("withdrawn")
    ]
    return {
        "id": market.get("id"),
        "description": market.get("description"),
        "market_type": mti.get("description", ""),
        "market_type_id": market.get("marketTypeId"),
        "status": market.get("status"),
        "period": period.get("fullDescription", ""),
        "period_id": market.get("periodId"),
        "team": team_name,
        "outcomes": outcomes,
    }


def _build_match(event: dict, include_odds: bool = True) -> dict:
    """Convert a raw Dafabet event dict into our clean match object."""
    opponents = {o["id"]: o["description"] for o in event.get("opponents", [])}
    paths = event.get("eventPaths", [])

    scores = [
        {
            "team": opponents.get(s.get("opponentId"), "Unknown"),
            "team_id": s.get("opponentId"),
            "score": s.get("formattedPoints") or s.get("points", "-"),
            "batting": s.get("serving", False),
        }
        for s in (event.get("scores") or {}).get("score", [])
    ]

    clock = event.get("clock") or {}

    raw_markets = event.get("markets") or []
    batting_team = next(
        (opponents.get(s.get("opponentId"), "") for s in (event.get("scores") or {}).get("score", []) if s.get("serving")),
        None,
    )
    clock_status = (event.get("clock") or {}).get("status")
    over_ball = _parse_cricket_outcomes(
        event.get("cricketOutcomes"),
        raw_markets,
        opponents,
        batting_team=batting_team,
        clock_status=clock_status,
    )

    result = {
        "id": event.get("id"),
        "match": event.get("description", ""),
        "competition": next((p["description"] for p in paths if p.get("tag") == "Tournament"), ""),
        "country": next((p["description"] for p in paths if p.get("tag") == "Country"), ""),
        "date": event.get("eventDate"),
        "period": event.get("currentPeriod"),
        "period_number": event.get("currentPeriodNumber"),
        "clock": {
            "running": clock.get("running", False),
            "minutes": clock.get("minutes", 0),
            "seconds": clock.get("seconds", 0),
            "status": clock.get("status"),
        },
        "scores": scores,
        "live": over_ball,          # over, ball, ball-by-ball data
        "live_market_count": event.get("liveOpenMarketCount", 0),
        "betradar_id": event.get("betRadarId"),
        "slug": event.get("slug"),
    }

    if include_odds:
        markets_by_type: dict[str, list] = {}
        all_markets = []
        for m in raw_markets:
            simple = _simplify_market(m, opponents)
            all_markets.append(simple)
            key = simple["market_type"] or simple["description"]
            markets_by_type.setdefault(key, []).append(simple)
        result["odds"] = {
            "market_count": len(all_markets),
            "markets": all_markets,
            "by_type": markets_by_type,
        }

    return result


# ---------------------------------------------------------------------------
# Public sync function (called by the background worker)
# ---------------------------------------------------------------------------

def fetch_and_cache_cricket_data() -> dict:
    """
    Fetch all live cricket data from Dafabet and write it into Redis.
    Called by the `sync_cricket_data` management command every 5 seconds.
    Returns a dict with counts for logging.
    """
    data, err = _fetch(f"{_BASE}/events", {
        "allBettableEvents": "true",
        "bettable": "true",
        "includeLiveEvents": "true",
        "includeMarkets": "true",
        "includeHiddenOutcomes": "false",
        "lightWeightResponse": "false",
        "liveAboutToStart": "true",
        "liveExcludeLongTermSuspended": "true",
        "liveMarketStatus": "OPEN,SUSPENDED",
        "marketFilter": "GAME",
        "marketStatus": "OPEN",
        "sortMarketsByPriceDifference": "true",
        "sportGroups": "REGULAR",
        "periodType": "IN_RUNNING",
        "eventPathIds": _CRICKET_PATH_ID,
        "liveOnly": "true",
        "marketTypeIds": _CRICKET_MARKET_TYPE_IDS,
        "periodTypeIds": _CRICKET_PERIOD_TYPE_IDS,
        "excludeLongTermSuspended": "true",
        "excludeMarketByOpponent": "false",
        "maxMarketsPerMarketType": "10",
        "maxMarketPerEvent": "100",
        "l": "en-GB",
    })

    if err or data is None:
        logger.warning("Cricket sync: upstream fetch failed")
        return {"ok": False}

    raw_events = data if isinstance(data, list) else data.get("events", [])

    # Strip virtual / SRL (Simulated Reality League) matches
    events = [e for e in raw_events if _is_real_match(e)]

    # Build the three different views of the data
    matches_with_odds = [_build_match(e, include_odds=True)  for e in events]
    scores_only       = [_build_match(e, include_odds=False) for e in events]

    # Odds-only view (same as matches_with_odds but only id/match/scores/odds)
    odds_only = [
        {
            "id": m["id"],
            "match": m["match"],
            "competition": m["competition"],
            "period": m["period"],
            "scores": m["scores"],
            "odds": m.get("odds", {}),
        }
        for m in matches_with_odds
    ]

    _cache_set(REDIS_KEY_MATCHES, matches_with_odds, REDIS_TTL)
    _cache_set(REDIS_KEY_SCORES,  scores_only,       REDIS_TTL)
    _cache_set(REDIS_KEY_ODDS,    odds_only,         REDIS_TTL)

    # Timestamp
    from django.utils import timezone
    ts = timezone.now().isoformat()
    _cache_set(REDIS_KEY_SYNC_TS, ts, 3600)

    total_markets = sum(
        m.get("odds", {}).get("market_count", 0) for m in matches_with_odds
    )
    logger.info(
        "Cricket sync OK — %d real matches (%d total incl. virtual/SRL), %d markets",
        len(events), len(raw_events), total_markets,
    )
    return {"ok": True, "matches": len(events), "markets": total_markets}


def _build_upcoming_match(event: dict) -> dict:
    """Convert a raw Dafabet upcoming event into a clean upcoming-match object."""
    opponents = {o["id"]: o["description"] for o in event.get("opponents", [])}
    paths     = event.get("eventPaths", [])

    # Build odds from all available markets
    markets_out = []
    for m in (event.get("markets") or []):
        simple = _simplify_market(m, opponents)
        markets_out.append(simple)

    return {
        "id":          event.get("id"),
        "match":       event.get("description", ""),
        "competition": next((p["description"] for p in paths if p.get("tag") in ("Tournament", "League")), ""),
        "country":     next((p["description"] for p in paths if p.get("tag") == "Country"), ""),
        "date":        event.get("eventDate"),
        "slug":        event.get("slug"),
        "betradar_id": event.get("betRadarId"),
        "odds": {
            "market_count": len(markets_out),
            "markets":      markets_out,
        },
    }


def fetch_and_cache_upcoming_matches() -> dict:
    """
    Fetch upcoming (pre-match) cricket events from Dafabet and store in Redis.
    Only real matches (no SRL / Virtual). Includes available odds (H2H, totals etc.)
    """
    data, err = _fetch(f"{_BASE}/events", {
        "bettable":               "true",
        "includeMarkets":         "true",
        "lightWeightResponse":    "false",
        "marketFilter":           "GAME",
        "marketStatus":           "OPEN",
        "sportGroups":            "REGULAR",
        "eventPathIds":           _CRICKET_PATH_ID,
        "liveOnly":               "false",
        "includeLiveEvents":      "false",
        "marketTypeIds":          _CRICKET_MARKET_TYPE_IDS,
        "maxMarketsPerMarketType": "10",
        "maxMarketPerEvent":      "30",
        "l":                      "en-GB",
    })

    if err or data is None:
        logger.warning("Cricket upcoming sync: upstream fetch failed")
        return {"ok": False}

    raw_events = data if isinstance(data, list) else data.get("events", [])

    # Only real MATCH events (type GAMEEVENT), no SRL/Virtual, no outright bets
    events = [
        e for e in raw_events
        if e.get("eventType") == "GAMEEVENT" and _is_real_match(e)
    ]

    upcoming = [_build_upcoming_match(e) for e in events]
    _cache_set(REDIS_KEY_UPCOMING, upcoming, REDIS_TTL * 4)   # cache 4x longer than live

    logger.info("Cricket upcoming sync OK — %d matches", len(upcoming))
    return {"ok": True, "matches": len(upcoming)}


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

@api_view(["GET"])
@permission_classes([AllowAny])
def cricket_live_matches(request):
    """
    GET /api/cricket/live-matches/

    All live cricket matches with scores AND all betting odds (from Redis cache).
    Refreshed every ~5 seconds by the background sync worker.

    Optional:
      ?no_odds=true   — return scores only (same as /scores/ endpoint)
      ?refresh=true   — bypass cache and fetch directly from upstream right now
    """
    no_odds = request.GET.get("no_odds", "false").lower() == "true"
    force   = request.GET.get("refresh",  "false").lower() == "true"

    if force:
        result = fetch_and_cache_cricket_data()
        if not result.get("ok"):
            return Response({"error": "sync_failed", "detail": "Could not fetch from upstream."}, status=502)

    cache_key = REDIS_KEY_SCORES if no_odds else REDIS_KEY_MATCHES
    matches = _cache_get(cache_key)

    # Cold cache fallback
    if matches is None:
        logger.info("Cricket cache cold — falling back to direct fetch")
        fetch_and_cache_cricket_data()
        matches = _cache_get(cache_key) or []

    last_sync = _cache_get(REDIS_KEY_SYNC_TS)

    return Response({
        "count": len(matches),
        "sport": "Cricket",
        "sport_id": int(_CRICKET_PATH_ID),
        "last_sync": last_sync,
        "matches": matches,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def cricket_scores(request):
    """
    GET /api/cricket/scores/

    Score-only view — team names, current score, who is batting, period, clock.
    Served from Redis cache. No odds. Best for live score tickers and widgets.
    """
    matches = _cache_get(REDIS_KEY_SCORES)
    if matches is None:
        fetch_and_cache_cricket_data()
        matches = _cache_get(REDIS_KEY_SCORES) or []

    last_sync = _cache_get(REDIS_KEY_SYNC_TS)
    return Response({"count": len(matches), "last_sync": last_sync, "matches": matches})


@api_view(["GET"])
@permission_classes([AllowAny])
def cricket_odds(request):
    """
    GET /api/cricket/odds/

    All open betting odds for every live cricket match, grouped by type.
    Served from Redis cache (refreshed every ~5 s).

    Market types in the response:
      Head To Head - Live Match
      Over/Under Runs - Live 1st Innings
      Total runs for over X in Xth inning TEAM
      Total runs after X overs TEAM
      Total Spreads TEAM
      Who Will Win The Toss? - Live Match
    """
    matches = _cache_get(REDIS_KEY_ODDS)
    if matches is None:
        fetch_and_cache_cricket_data()
        matches = _cache_get(REDIS_KEY_ODDS) or []

    last_sync = _cache_get(REDIS_KEY_SYNC_TS)
    return Response({"count": len(matches), "last_sync": last_sync, "matches": matches})


@api_view(["GET"])
@permission_classes([AllowAny])
def cricket_live_changes(request):
    """
    GET /api/cricket/changes/?bn=<batch_number>

    Real-time price/score delta polling — proxied directly (not cached).
    Use this to get only what changed since your last poll.

    How to use:
      1. First call: omit bn (defaults to -1) → get full state + next_bn
      2. Store next_bn from response
      3. Poll every 2-5 s: GET /api/cricket/changes/?bn=<next_bn>
      4. Apply price changes to your local state

    change fields:
      outcome_id, event_id, market_id — which outcome changed
      price_decimal, price_formatted  — new price
      hidden                          — whether market is now hidden
    """
    bn = request.GET.get("bn", "-1")

    data, err = _fetch(f"{_BASE}/live/changes", {
        "eventPathId": _CRICKET_PATH_ID,
        "marketTypeIds": _CRICKET_MARKET_TYPE_IDS,
        "periodTypeIds": _CRICKET_PERIOD_TYPE_IDS,
        "includeOpponentMarkets": "true",
        "bn": bn,
        "v": "2",
    })
    if err:
        return err

    items = data if isinstance(data, list) else []
    next_bn = next((i.get("bn") for i in items if i.get("t") == "b"), None)

    # Store last known bn for the worker to pick up
    if next_bn:
        _cache_set(REDIS_KEY_SYNC_BN, next_bn, 3600)

    changes = [
        {
            "outcome_id": c.get("id"),
            "event_id": c.get("eid"),
            "market_id": c.get("mid"),
            "price_decimal": ((c.get("clp") or {}).get("cp") or {}).get("d"),
            "price_formatted": ((c.get("clp") or {}).get("cp") or {}).get("f"),
            "hidden": c.get("h", False),
        }
        for c in items if c.get("t") == "p"
    ]

    return Response({
        "next_bn": next_bn,
        "change_count": len(changes),
        "changes": changes,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def cricket_markets(request):
    """
    GET /api/cricket/markets/?ids=<id1>,<id2>,...

    Fetch fresh odds for specific market IDs (comma-separated).
    Use market IDs from the `id` field inside any market in /odds/ or /live-matches/.

    Example:
      /api/cricket/markets/?ids=4545656442,4545655499
    """
    ids = request.GET.get("ids", "").strip()
    if not ids:
        return Response(
            {"error": "missing_param", "detail": "Provide ?ids=id1,id2,... in the query string."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    data, err = _fetch(f"{_BASE}/markets/{ids}", {"includePrices": "true", "l": "en-GB"})
    if err:
        return err

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
def cricket_all_live_events(request):
    """
    GET /api/cricket/all-live-events/

    Sport-level snapshot: event counts and open-market counts for all sports.
    Useful for live match badges (e.g. "8 live cricket matches").
    """
    data, err = _fetch(f"{_BASE}/live/events", {
        "allBettableEvents": "true",
        "excludeLongTermSuspended": "true",
        "includeAboutToStart": "true",
        "lightWeightResponse": "false",
        "marketStatuses": "OPEN,SUSPENDED",
        "sportGroups": "REGULAR",
        "onlySports": "true",
        "l": "en-GB",
    })
    if err:
        return err

    sports = data.get("sports", []) if isinstance(data, dict) else []
    cricket = next((s for s in sports if s.get("id") == int(_CRICKET_PATH_ID)), None)

    return Response({
        "updated": data.get("updated") if isinstance(data, dict) else None,
        "cricket": cricket,
        "all_sports": sports,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def cricket_match_list(request):
    """
    GET /api/cricket/matches/

    Returns all live real cricket matches as a lightweight list.
    Each item has enough info to build a match card UI (id, teams, score, period).
    Click on a match → call /api/cricket/matches/<id>/ for full score + odds.
    """
    matches = _cache_get(REDIS_KEY_SCORES)
    if matches is None:
        fetch_and_cache_cricket_data()
        matches = _cache_get(REDIS_KEY_SCORES) or []

    last_sync = _cache_get(REDIS_KEY_SYNC_TS)

    # Slim down to just what a match-list card needs
    listing = []
    for m in matches:
        batting_team = next((s["team"] for s in m["scores"] if s["batting"]), None)
        listing.append({
            "id":          m["id"],
            "match":       m["match"],
            "competition": m["competition"],
            "country":     m["country"],
            "period":      m["period"],
            "clock":       m["clock"],
            "scores":      m["scores"],
            "batting":     batting_team,
            "live":        m.get("live"),
            "markets":     m.get("live_market_count", 0),
            "detail_url":  f"/api/cricket/matches/{m['id']}/",
        })

    return Response({
        "count":     len(listing),
        "last_sync": last_sync,
        "matches":   listing,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def cricket_match_detail(request, match_id: int):
    """
    GET /api/cricket/matches/<match_id>/

    Returns full score + all odds for one specific match.
    match_id comes from the `id` field in /api/cricket/matches/.

    Response includes:
      - scores        current innings score for each team, who is batting
      - clock         current over/time, running status
      - period        e.g. "1st Innings"
      - odds.markets  every open market with outcomes and decimal prices
      - odds.by_type  same markets grouped by type for easy display
    """
    matches = _cache_get(REDIS_KEY_MATCHES)
    if matches is None:
        fetch_and_cache_cricket_data()
        matches = _cache_get(REDIS_KEY_MATCHES) or []

    match = next((m for m in matches if m["id"] == match_id), None)

    if match is None:
        return Response(
            {
                "error": "not_found",
                "detail": f"No live match with id={match_id}. "
                          f"Get current match ids from /api/cricket/matches/",
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    last_sync = _cache_get(REDIS_KEY_SYNC_TS)
    return Response({"last_sync": last_sync, "match": match})


@api_view(["GET"])
@permission_classes([AllowAny])
def cricket_upcoming_matches(request):
    """
    GET /api/cricket/upcoming/

    Returns all upcoming (pre-match) real cricket matches with available odds.
    Served from Redis cache, refreshed every ~2 minutes by the background worker.

    Response fields per match:
      id          — Dafabet event ID
      match       — "Team A vs Team B"
      competition — tournament/league name
      country     — country
      date        — ISO-8601 start time (UTC)
      odds        — markets with outcomes and decimal prices
    """
    upcoming = _cache_get(REDIS_KEY_UPCOMING)
    if upcoming is None:
        fetch_and_cache_upcoming_matches()
        upcoming = _cache_get(REDIS_KEY_UPCOMING) or []

    last_sync = _cache_get(REDIS_KEY_SYNC_TS)

    return Response({
        "count":     len(upcoming),
        "last_sync": last_sync,
        "matches":   upcoming,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def cricket_sync_status(request):
    """
    GET /api/cricket/sync-status/

    Health check — shows when data was last synced, how many matches are cached,
    and whether the background worker is running.
    """
    last_sync = _cache_get(REDIS_KEY_SYNC_TS)
    matches   = _cache_get(REDIS_KEY_MATCHES) or []
    sync_bn   = _cache_get(REDIS_KEY_SYNC_BN)

    total_markets = sum(
        m.get("odds", {}).get("market_count", 0) for m in matches
    )

    # Worker is "alive" if last sync was within 20 seconds
    worker_alive = False
    if last_sync:
        from django.utils import timezone
        import datetime
        try:
            sync_dt = timezone.datetime.fromisoformat(last_sync)
            if timezone.is_naive(sync_dt):
                sync_dt = timezone.make_aware(sync_dt)
            diff = (timezone.now() - sync_dt).total_seconds()
            worker_alive = diff < 20
        except Exception:
            pass

    return Response({
        "worker_alive": worker_alive,
        "last_sync": last_sync,
        "cached_matches": len(matches),
        "cached_markets": total_markets,
        "last_batch_number": sync_bn,
    })
