"""
Shared DafaBet sports feed (Soccer / Tennis / …)
=================================================
Same pattern as cricket:
  - Background worker polls DafaBet → Redis
  - Public APIs serve only from Redis (cold-cache falls back to a direct fetch)

Sport configs:
  soccer  → eventPathId 240 (Football)
  tennis  → eventPathId 239 (Tennis)
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone as dt_timezone
from typing import Any

import requests
from django.utils import timezone

logger = logging.getLogger("game")

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

REDIS_TTL = 120
UPCOMING_TTL = 180

SPORTS: dict[str, dict[str, Any]] = {
    "soccer": {
        "slug": "soccer",
        "name": "Football",
        "path_id": "240",
        "sport_code": "FOOT",
    },
    "tennis": {
        "slug": "tennis",
        "name": "Tennis",
        "path_id": "239",
        "sport_code": "TENN",
    },
}


def _keys(sport: str) -> dict[str, str]:
    s = sport.lower().strip()
    return {
        "matches": f"{s}:matches",
        "scores": f"{s}:scores",
        "odds": f"{s}:odds",
        "upcoming": f"{s}:upcoming",
        "sync_ts": f"{s}:last_sync",
        "sync_bn": f"{s}:sync_bn",
    }


def get_sport_config(sport: str) -> dict[str, Any]:
    cfg = SPORTS.get((sport or "").lower().strip())
    if not cfg:
        raise ValueError(f"Unknown sport: {sport}")
    return cfg


# ---------------------------------------------------------------------------
# Redis helpers
# ---------------------------------------------------------------------------

def _redis():
    try:
        from game.utils import get_redis_client
        return get_redis_client()
    except Exception:
        return None


def cache_get(key: str):
    try:
        r = _redis()
        if r is None:
            return None
        raw = r.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.warning("sports cache read error [%s]: %s", key, exc)
        return None


def cache_set(key: str, value, ttl: int = REDIS_TTL):
    try:
        r = _redis()
        if r is None:
            return
        r.setex(key, ttl, json.dumps(value, default=str))
    except Exception as exc:
        logger.warning("sports cache write error [%s]: %s", key, exc)


# ---------------------------------------------------------------------------
# Upstream fetch
# ---------------------------------------------------------------------------

def fetch_upstream(url: str, params: dict | None = None, timeout: int = 20, retries: int = 2):
    last_err = None
    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, headers=_HEADERS, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp.json(), None
        except requests.exceptions.Timeout:
            last_err = {"error": "upstream_timeout", "status_code": 504}
        except requests.exceptions.HTTPError as exc:
            code = exc.response.status_code if exc.response is not None else 0
            last_err = {"error": "upstream_error", "status_code": code, "detail": f"HTTP {code}"}
            if code and code < 500:
                return None, last_err
        except Exception as exc:
            last_err = {"error": "proxy_error", "detail": str(exc)[:200]}
        if attempt < retries:
            time.sleep(0.4 * (attempt + 1))
    return None, last_err


# ---------------------------------------------------------------------------
# Transform helpers
# ---------------------------------------------------------------------------

def _is_real_match(event: dict) -> bool:
    description = event.get("description", "") or ""
    if "(Virtual)" in description:
        return False
    if " Srl " in description or description.endswith(" Srl"):
        return False
    for p in event.get("eventPaths") or []:
        pdesc = p.get("description", "") or ""
        if "SRL" in pdesc or "Srl" in pdesc or "Simulated Reality" in pdesc:
            return False
        if "Virtual" in pdesc and "Football" in pdesc:
            return False
    for opp in event.get("opponents") or []:
        if (opp.get("description") or "").endswith(" Srl"):
            return False
    return event.get("eventType", "GAMEEVENT") == "GAMEEVENT"


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


def _path_desc(paths: list, *tags: str) -> str:
    for tag in tags:
        for p in paths:
            if p.get("tag") == tag:
                return p.get("description") or ""
    # fallback: last non-sport path
    for p in reversed(paths or []):
        if p.get("tag") not in ("Sport", None):
            return p.get("description") or ""
    return ""


def _sets_summary(event: dict, opponents: dict) -> dict | None:
    sets = event.get("sets") or {}
    game_set = sets.get("gameSet") or []
    if not game_set and not sets.get("maxSets"):
        return None
    return {
        "max_sets": sets.get("maxSets") or 0,
        "sets": [
            {
                "team": opponents.get(s.get("opponentId"), "Unknown"),
                "team_id": s.get("opponentId"),
                "points": s.get("formattedPoints") or s.get("points"),
                "winner": s.get("winner", False),
            }
            for s in game_set
        ],
    }


def build_match(event: dict, include_odds: bool = True) -> dict:
    opponents = {o["id"]: o["description"] for o in event.get("opponents", [])}
    paths = event.get("eventPaths") or []
    clock = event.get("clock") or {}

    scores = []
    for s in (event.get("scores") or {}).get("score", []) or []:
        scores.append({
            "team": opponents.get(s.get("opponentId"), "Unknown"),
            "team_id": s.get("opponentId"),
            "score": s.get("formattedPoints") if s.get("formattedPoints") is not None else s.get("points", "-"),
            "serving": bool(s.get("serving")),
            # cricket-compatible alias
            "batting": bool(s.get("serving")),
            "red_cards": s.get("redCards"),
            "yellow_cards": s.get("yellowCards"),
            "corners": s.get("corners"),
        })

    result = {
        "id": event.get("id"),
        "match": event.get("description", ""),
        "competition": _path_desc(paths, "Tournament", "League", "Category"),
        "country": _path_desc(paths, "Country", "Category"),
        "date": event.get("eventDate"),
        "period": event.get("currentPeriod") or event.get("currentPeriodAbbreviation"),
        "period_number": event.get("currentPeriodNumber"),
        "clock": {
            "running": clock.get("running", False),
            "minutes": clock.get("minutes", 0),
            "seconds": clock.get("seconds", 0),
            "status": clock.get("status"),
            "period_remaining": clock.get("periodRemainingTime"),
        },
        "scores": scores,
        "sets": _sets_summary(event, opponents),
        "live_market_count": event.get("liveOpenMarketCount", 0),
        "betradar_id": event.get("betRadarId"),
        "slug": event.get("slug"),
        "sport_code": event.get("sportCode"),
    }

    if include_odds:
        markets_by_type: dict[str, list] = {}
        all_markets = []
        for m in event.get("markets") or []:
            simple = _simplify_market(m, opponents)
            all_markets.append(simple)
            key = simple["market_type"] or simple["description"] or "Other"
            markets_by_type.setdefault(key, []).append(simple)
        result["odds"] = {
            "market_count": len(all_markets),
            "markets": all_markets,
            "by_type": markets_by_type,
        }

    return result


def build_upcoming_match(event: dict) -> dict:
    opponents = {o["id"]: o["description"] for o in event.get("opponents", [])}
    paths = event.get("eventPaths") or []
    markets_out = [_simplify_market(m, opponents) for m in (event.get("markets") or [])]
    return {
        "id": event.get("id"),
        "match": event.get("description", ""),
        "competition": _path_desc(paths, "Tournament", "League", "Category"),
        "country": _path_desc(paths, "Country", "Category"),
        "date": event.get("eventDate"),
        "slug": event.get("slug"),
        "betradar_id": event.get("betRadarId"),
        "odds": {
            "market_count": len(markets_out),
            "markets": markets_out,
        },
    }


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------

def _live_events_params(path_id: str) -> dict:
    return {
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
        "eventPathIds": str(path_id),
        "liveOnly": "true",
        "excludeLongTermSuspended": "true",
        "excludeMarketByOpponent": "false",
        # Keep payloads small — football can otherwise return 30MB+ and OOM the worker
        "maxMarketsPerMarketType": "8",
        "maxMarketPerEvent": "25",
        "l": "en-GB",
    }


def _upcoming_events_params(path_id: str) -> dict:
    return {
        "allBettableEvents": "true",
        "bettable": "true",
        "includeMarkets": "true",
        "includeHiddenOutcomes": "false",
        "lightWeightResponse": "false",
        "marketFilter": "GAME",
        "marketStatus": "OPEN",
        "sportGroups": "REGULAR",
        "eventPathIds": str(path_id),
        "liveOnly": "false",
        "includeLiveEvents": "false",
        "maxMarketsPerMarketType": "5",
        "maxMarketPerEvent": "12",
        "l": "en-GB",
    }


def fetch_and_cache_live(sport: str) -> dict:
    cfg = get_sport_config(sport)
    keys = _keys(cfg["slug"])
    data, err = fetch_upstream(f"{_BASE}/events", _live_events_params(cfg["path_id"]), timeout=35)
    if err or data is None:
        logger.warning("%s sync: upstream fetch failed: %s", cfg["slug"], err)
        return {"ok": False, "sport": cfg["slug"]}

    raw_events = data if isinstance(data, list) else data.get("events", [])
    events = [e for e in raw_events if _is_real_match(e)]

    matches_with_odds = [build_match(e, include_odds=True) for e in events]
    scores_only = [build_match(e, include_odds=False) for e in events]
    odds_only = [
        {
            "id": m["id"],
            "match": m["match"],
            "competition": m["competition"],
            "period": m["period"],
            "scores": m["scores"],
            "sets": m.get("sets"),
            "odds": m.get("odds", {}),
        }
        for m in matches_with_odds
    ]

    cache_set(keys["matches"], matches_with_odds, REDIS_TTL)
    cache_set(keys["scores"], scores_only, REDIS_TTL)
    cache_set(keys["odds"], odds_only, REDIS_TTL)
    cache_set(keys["sync_ts"], timezone.now().isoformat(), REDIS_TTL)

    market_count = sum(m.get("odds", {}).get("market_count", 0) for m in matches_with_odds)
    return {
        "ok": True,
        "sport": cfg["slug"],
        "matches": len(matches_with_odds),
        "markets": market_count,
    }


def fetch_and_cache_upcoming(sport: str) -> dict:
    cfg = get_sport_config(sport)
    keys = _keys(cfg["slug"])
    data, err = fetch_upstream(f"{_BASE}/events", _upcoming_events_params(cfg["path_id"]), timeout=45)
    if err or data is None:
        logger.warning("%s upcoming sync failed: %s", cfg["slug"], err)
        return {"ok": False, "sport": cfg["slug"]}

    raw_events = data if isinstance(data, list) else data.get("events", [])
    events = [e for e in raw_events if _is_real_match(e)]
    # Cap payload size — football upcoming can be huge
    events = events[:200]
    upcoming = [build_upcoming_match(e) for e in events]
    cache_set(keys["upcoming"], upcoming, UPCOMING_TTL)
    return {"ok": True, "sport": cfg["slug"], "matches": len(upcoming)}


def apply_price_changes(sport: str, price_changes: list) -> int:
    keys = _keys(sport)
    updates: dict[int, tuple] = {}
    for c in price_changes:
        oid = c.get("id")
        cp = (c.get("clp") or {}).get("cp") or {}
        if oid and cp.get("d") is not None:
            updates[oid] = (cp["d"], cp.get("f"), c.get("h", False))
    if not updates:
        return 0

    changed = 0
    for cache_key in (keys["matches"], keys["odds"]):
        cached = cache_get(cache_key)
        if not cached:
            continue
        dirty = False
        for match in cached:
            for market in (match.get("odds") or {}).get("markets") or []:
                for outcome in market.get("outcomes") or []:
                    oid = outcome.get("id")
                    if oid in updates:
                        new_dec, new_fmt, hidden = updates[oid]
                        outcome["prev_price_decimal"] = outcome.get("price_decimal")
                        outcome["prev_price_formatted"] = outcome.get("price_formatted")
                        outcome["price_decimal"] = new_dec
                        outcome["price_formatted"] = new_fmt
                        outcome["hidden"] = hidden
                        dirty = True
                        changed += 1
        if dirty:
            cache_set(cache_key, cached, REDIS_TTL)
    return changed


def poll_delta(sport: str, last_bn: str = "-1") -> tuple[str, int, dict | None]:
    """
    Poll /live/changes for a sport.
    Returns (next_bn, price_change_count, error_or_None)
    """
    cfg = get_sport_config(sport)
    keys = _keys(cfg["slug"])
    data, err = fetch_upstream(
        f"{_BASE}/live/changes",
        {
            "eventPathId": cfg["path_id"],
            "includeOpponentMarkets": "true",
            "bn": last_bn or "-1",
            "v": "2",
        },
        timeout=12,
        retries=1,
    )
    if err or data is None:
        return last_bn or "-1", 0, err

    items = data if isinstance(data, list) else []
    next_bn = next((str(i.get("bn")) for i in items if i.get("t") == "b"), None) or last_bn
    if next_bn:
        cache_set(keys["sync_bn"], next_bn, 3600)
    price_changes = [i for i in items if i.get("t") == "p"]
    n = apply_price_changes(cfg["slug"], price_changes) if price_changes else 0
    return next_bn, n, None


def ensure_live_cache(sport: str) -> list:
    keys = _keys(sport)
    matches = cache_get(keys["matches"])
    if matches is None:
        fetch_and_cache_live(sport)
        matches = cache_get(keys["matches"]) or []
    return matches
