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
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from decimal import Decimal

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
REDIS_KEY_RESULTS  = "cricket:results"
REDIS_KEY_SYNC_TS  = "cricket:last_sync"
REDIS_KEY_SYNC_BN  = "cricket:sync_bn"
# Must be longer than the full-sync interval (30s). If this is too short the
# cache goes empty between syncs and /matches + /bet fail intermittently.
REDIS_TTL = 120

# Dafabet outcome.result.result → our clean codes
_RESULT_MAP = {
    "NO_RESULT": "NO_RESULT",
    "WIN": "WIN",
    "WON": "WIN",
    "WINNER": "WIN",
    "LOSE": "LOSE",
    "LOST": "LOSE",
    "LOSER": "LOSE",
    "VOID": "VOID",
    "CANCEL": "VOID",
    "CANCELLED": "VOID",
    "CANCELED": "VOID",
    "PUSH": "VOID",
    "REFUND": "VOID",
    "DEAD_HEAT": "VOID",
    "DEADHEAT": "VOID",
}


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

def _fetch(url: str, params: dict | None = None, timeout: int = 12, retries: int = 2):
    """
    GET with error handling and automatic retry on transient errors.
    Returns (json_data, None) on success or (None, error_response) on failure.
    Retries up to `retries` times on 5xx / network errors (not on 4xx).
    """
    import time as _time
    last_err = None
    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, headers=_HEADERS, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp.json(), None
        except requests.exceptions.Timeout:
            logger.warning("Cricket upstream timeout (attempt %d): %s", attempt + 1, url)
            last_err = Response(
                {"error": "upstream_timeout", "detail": "Data source timed out."},
                status=status.HTTP_504_GATEWAY_TIMEOUT,
            )
        except requests.exceptions.HTTPError as exc:
            code = exc.response.status_code if exc.response is not None else 0
            logger.warning("Cricket upstream HTTP %s (attempt %d): %s", code, attempt + 1, url)
            last_err = Response(
                {"error": "upstream_error", "detail": f"HTTP {code}", "status_code": code},
                status=status.HTTP_502_BAD_GATEWAY,
            )
            if code < 500:
                # 4xx errors won't improve with retry — fail fast
                return None, last_err
        except Exception as exc:
            logger.exception("Cricket upstream error (attempt %d): %s", attempt + 1, exc)
            last_err = Response(
                {"error": "proxy_error", "detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if attempt < retries:
            _time.sleep(0.5 * (attempt + 1))   # 0.5s, then 1.0s backoff

    return None, last_err


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

    # If PAUSED with no ball-by-ball data, still attempt market inference — the
    # batting_team filter below prevents picking up next-innings markets.
    # (Returning early was too aggressive: Test matches are often PAUSED between overs.)

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
            for n in re.findall(r'(?<!after )\bin [Oo]ver\s+(\d+)', desc):
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

def _normalize_result_code(raw) -> tuple[str, str]:
    """
    Convert Dafabet outcome.result into (clean_code, raw_string).
    clean_code: NO_RESULT | WIN | LOSE | VOID | UNKNOWN
    """
    if raw is None:
        return "NO_RESULT", ""
    if isinstance(raw, dict):
        raw_str = str(raw.get("result") or "").strip().upper()
    else:
        raw_str = str(raw).strip().upper()
    if not raw_str:
        return "NO_RESULT", ""
    return _RESULT_MAP.get(raw_str, "UNKNOWN"), raw_str


def _simplify_outcome(outcome: dict) -> dict:
    cp = (outcome.get("consolidatedPrice") or {}).get("currentPrice") or {}
    pp = (outcome.get("consolidatedPrice") or {}).get("penultimatePrice") or {}
    result_code, raw_result = _normalize_result_code(outcome.get("result"))
    return {
        "id": outcome.get("id"),
        "description": outcome.get("description"),
        "price_decimal": cp.get("decimal"),
        "price_formatted": cp.get("format"),
        "prev_price_decimal": pp.get("decimal") or None,
        "line": outcome.get("extraKey1"),
        "withdrawn": outcome.get("withdrawn", False),
        "hidden": outcome.get("hidden", False),
        "result": result_code,
        "result_raw": raw_result or None,
    }


def ingest_cricket_results_from_events(raw_events: list) -> dict:
    """
    Persist Dafabet outcome.result values into CricketOutcomeResult.
    This is the ONLY source used for settlement.
    """
    from game.models import CricketOutcomeResult

    if not raw_events:
        return {"upserted": 0, "final": 0}

    upserted = 0
    final_count = 0
    for event in raw_events:
        if not _is_real_match(event):
            continue
        event_id = event.get("id")
        event_name = (event.get("description") or "")[:255]
        for market in (event.get("markets") or []):
            market_id = market.get("id")
            if not market_id:
                continue
            market_name = (market.get("description") or "")[:255]
            market_status = str(market.get("status") or "")[:40]
            for outcome in (market.get("outcomes") or []):
                outcome_id = outcome.get("id")
                if not outcome_id:
                    continue
                result_code, raw_result = _normalize_result_code(outcome.get("result"))
                is_final = result_code in ("WIN", "LOSE", "VOID")
                CricketOutcomeResult.objects.update_or_create(
                    outcome_id=outcome_id,
                    defaults={
                        "event_id": event_id,
                        "event_name": event_name,
                        "market_id": market_id,
                        "market_name": market_name,
                        "market_status": market_status,
                        "outcome_name": (outcome.get("description") or "")[:255],
                        "result_code": result_code,
                        "raw_result": raw_result[:40],
                        "is_final": is_final,
                    },
                )
                upserted += 1
                if is_final:
                    final_count += 1

    # Refresh Redis snapshot of final results for the public API
    _cache_results_snapshot()
    return {"upserted": upserted, "final": final_count}


def _cache_results_snapshot():
    """Cache a clean nested results payload for fast API reads."""
    from game.models import CricketOutcomeResult

    rows = CricketOutcomeResult.objects.filter(is_final=True).order_by("-updated_at")[:500]
    by_event: dict[int, dict] = {}
    for r in rows:
        ev = by_event.setdefault(r.event_id, {
            "event_id": r.event_id,
            "event_name": r.event_name,
            "markets": {},
        })
        mk = ev["markets"].setdefault(r.market_id, {
            "market_id": r.market_id,
            "market_name": r.market_name,
            "market_status": r.market_status,
            "settled": True,
            "outcomes": [],
        })
        mk["outcomes"].append({
            "outcome_id": r.outcome_id,
            "outcome_name": r.outcome_name,
            "result": r.result_code,
            "result_raw": r.raw_result or None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        })

    payload = []
    for ev in by_event.values():
        payload.append({
            "event_id": ev["event_id"],
            "event_name": ev["event_name"],
            "markets": list(ev["markets"].values()),
        })
    _cache_set(REDIS_KEY_RESULTS, payload, 300)


def settle_cricket_bets_from_results() -> dict:
    """
    Settle PENDING CricketBet rows using CricketOutcomeResult only.
    WIN  → credit stake * odds
    LOSE → no credit
    VOID → refund stake
    """
    from django.db import transaction as db_transaction
    from django.utils import timezone
    from game.models import CricketBet, CricketOutcomeResult
    from accounts.models import Wallet, Transaction as Txn

    pending = list(CricketBet.objects.filter(status="PENDING").select_related("user"))
    if not pending:
        return {"settled": 0, "won": 0, "lost": 0, "void": 0}

    outcome_ids = [b.outcome_id for b in pending]
    results = {
        r.outcome_id: r
        for r in CricketOutcomeResult.objects.filter(outcome_id__in=outcome_ids, is_final=True)
    }
    if not results:
        return {"settled": 0, "won": 0, "lost": 0, "void": 0}

    won = lost = voided = 0
    now = timezone.now()

    for bet in pending:
        result = results.get(bet.outcome_id)
        if not result:
            continue
        code = result.result_code
        if code not in ("WIN", "LOSE", "VOID"):
            continue

        try:
            with db_transaction.atomic():
                locked = CricketBet.objects.select_for_update().get(pk=bet.pk)
                if locked.status != "PENDING":
                    continue

                wallet = Wallet.objects.select_for_update().get(user=locked.user)
                balance_before = wallet.balance
                payout = 0
                txn_type = "WIN"
                desc = ""

                if code == "WIN":
                    payout = int(Decimal(locked.stake) * Decimal(locked.odds))
                    wallet.balance += payout
                    locked.status = "WON"
                    locked.payout_amount = payout
                    won += 1
                    txn_type = "WIN"
                    desc = (
                        f"Cricket win #{locked.id}: {locked.event_name} / "
                        f"{locked.outcome_name} @ {locked.odds}"
                    )
                elif code == "LOSE":
                    locked.status = "LOST"
                    locked.payout_amount = 0
                    lost += 1
                    desc = ""
                else:  # VOID
                    payout = int(locked.stake)
                    wallet.balance += payout
                    locked.status = "VOID"
                    locked.payout_amount = payout
                    voided += 1
                    txn_type = "REFUND"
                    desc = (
                        f"Cricket void/refund #{locked.id}: {locked.event_name} / "
                        f"{locked.outcome_name}"
                    )

                locked.settled_at = now
                locked.save(update_fields=["status", "payout_amount", "settled_at"])

                if code in ("WIN", "VOID") and payout > 0:
                    wallet.save(update_fields=["balance", "updated_at"])
                    Txn.objects.create(
                        user=locked.user,
                        transaction_type=txn_type,
                        amount=payout,
                        balance_before=balance_before,
                        balance_after=wallet.balance,
                        description=desc,
                    )
        except Exception as exc:
            logger.exception("settle cricket bet #%s failed: %s", bet.id, exc)

    return {"settled": won + lost + voided, "won": won, "lost": lost, "void": voided}


def refresh_pending_bet_results() -> dict:
    """
    Re-fetch Dafabet markets for events that still have PENDING bets,
    ingest outcome.result, then settle.
    """
    from game.models import CricketBet

    event_ids = list(
        CricketBet.objects.filter(status="PENDING")
        .values_list("event_id", flat=True)
        .distinct()
    )
    if not event_ids:
        return {"events": 0, "ingest": {"upserted": 0, "final": 0}, "settle": {"settled": 0}}

    # Pull live+prematch book with H2H and main markets — same feed that carries outcome.result
    data, err = _fetch(f"{_BASE}/events", {
        "bettable": "true",
        "includeLiveEvents": "true",
        "includeMarkets": "true",
        "lightWeightResponse": "false",
        "marketFilter": "GAME",
        "marketStatus": "OPEN,SUSPENDED,CLOSED,RESULTED,SETTLED",
        "liveMarketStatus": "OPEN,SUSPENDED,CLOSED,RESULTED,SETTLED",
        "sportGroups": "REGULAR",
        "eventPathIds": _CRICKET_PATH_ID,
        "liveOnly": "false",
        "marketTypeIds": _CRICKET_MARKET_TYPE_IDS,
        "periodTypeIds": _CRICKET_PERIOD_TYPE_IDS,
        "maxMarketsPerMarketType": "20",
        "maxMarketPerEvent": "100",
        "l": "en-GB",
    })
    raw_events = data if isinstance(data, list) else []
    wanted = {int(x) for x in event_ids}
    matched = [e for e in raw_events if e.get("id") in wanted]

    ingest = ingest_cricket_results_from_events(matched)
    settle = settle_cricket_bets_from_results()
    return {"events": len(matched), "pending_events": len(event_ids), "ingest": ingest, "settle": settle}


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

    # Persist Dafabet outcome.result for settlement (source of truth)
    try:
        ingest_cricket_results_from_events(events)
    except Exception as exc:
        logger.warning("Cricket result ingest failed: %s", exc)

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

    try:
        ingest_cricket_results_from_events(events)
    except Exception as exc:
        logger.warning("Cricket upcoming result ingest failed: %s", exc)

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

    Returns the latest cached cricket data + current batch number.
    The background worker handles Dafabet polling internally — this endpoint
    never hits Dafabet directly, so it never returns 502 due to upstream errors.

    Clients should:
      1. Call GET /api/cricket/matches/ for the full initial state
      2. Poll this endpoint every 2-5 s for price changes
      3. Use next_bn from the response in the next poll
      4. Apply price changes to local state; full refresh comes from /matches/
    """
    last_sync = _cache_get(REDIS_KEY_SYNC_TS)
    next_bn   = _cache_get(REDIS_KEY_SYNC_BN)
    matches   = _cache_get(REDIS_KEY_MATCHES)

    if matches is None:
        fetch_and_cache_cricket_data()
        matches   = _cache_get(REDIS_KEY_MATCHES) or []
        next_bn   = _cache_get(REDIS_KEY_SYNC_BN)
        last_sync = _cache_get(REDIS_KEY_SYNC_TS)

    # Build a flat list of all current outcome prices so clients can diff locally
    changes = []
    for m in (matches or []):
        eid = m.get("id")
        for market in (m.get("odds") or {}).get("markets") or []:
            mid = market.get("id")
            for outcome in market.get("outcomes") or []:
                changes.append({
                    "outcome_id":      outcome.get("id"),
                    "event_id":        eid,
                    "market_id":       mid,
                    "price_decimal":   outcome.get("price_decimal"),
                    "price_formatted": outcome.get("price_formatted"),
                    "hidden":          outcome.get("hidden", False),
                })

    return Response({
        "next_bn":      next_bn,
        "last_sync":    last_sync,
        "change_count": len(changes),
        "changes":      changes,
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
    if err or data is None:
        return Response(
            {"error": "upstream_unavailable", "detail": "Market data temporarily unavailable. Retry in a moment."},
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
    if err or data is None:
        return Response(
            {"error": "upstream_unavailable", "detail": "Live event data temporarily unavailable. Retry in a moment."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

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


# ---------------------------------------------------------------------------
# Betting
# ---------------------------------------------------------------------------

def _find_cached_match(event_id: int) -> dict | None:
    """Find a match by id in live or upcoming Redis caches."""
    for key in (REDIS_KEY_MATCHES, REDIS_KEY_UPCOMING):
        for m in (_cache_get(key) or []):
            if m.get("id") == event_id:
                return m
    return None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def place_cricket_bet(request):
    """
    POST /api/cricket/bet/

    Place a bet on a cricket market outcome.
    Odds are always taken from Redis live/upcoming cache — client odds ignored.

    Body:
      event_id    (int)
      market_id   (int)
      outcome_id  (int)
      stake       (int)  — amount in rupees
    """
    from django.db import transaction as db_transaction
    from game.models import CricketBet
    from accounts.models import Wallet, Transaction as Txn

    data = request.data
    required = ["event_id", "market_id", "outcome_id", "stake"]
    missing = [f for f in required if f not in data]
    if missing:
        return Response(
            {"error": f"Missing fields: {', '.join(missing)}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        stake = int(data["stake"])
        event_id = int(data["event_id"])
        market_id = int(data["market_id"])
        outcome_id = int(data["outcome_id"])
    except (ValueError, TypeError):
        return Response(
            {"error": "event_id, market_id, outcome_id and stake must be integers"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if stake <= 0:
        return Response({"error": "stake must be positive"}, status=status.HTTP_400_BAD_REQUEST)

    match = _find_cached_match(event_id)
    if not match:
        return Response(
            {"error": f"Event {event_id} not found in live/upcoming data"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    event_name = match.get("match") or match.get("description") or ""
    markets = (match.get("odds") or {}).get("markets") or match.get("markets") or []

    market_obj = next((m for m in markets if m.get("id") == market_id), None)
    if market_obj is None:
        return Response(
            {"error": f"Market {market_id} not found for this event"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    market_status = (market_obj.get("status") or "OPEN").upper()
    if market_status not in ("OPEN", "ACTIVE", ""):
        return Response(
            {"error": f'Market "{market_obj.get("description")}" is not open for betting'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    market_name = market_obj.get("description") or ""
    outcome_obj = next(
        (o for o in (market_obj.get("outcomes") or []) if o.get("id") == outcome_id),
        None,
    )
    if outcome_obj is None:
        return Response(
            {"error": f"Outcome {outcome_id} not found in market"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if outcome_obj.get("hidden") or outcome_obj.get("withdrawn"):
        return Response(
            {"error": "This outcome is no longer available"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    outcome_name = outcome_obj.get("description") or ""
    try:
        real_odds = Decimal(str(outcome_obj.get("price_decimal")))
    except Exception:
        real_odds = None

    if real_odds is None or real_odds <= 1:
        return Response(
            {"error": "Odds not available or invalid for this outcome"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    potential_payout = int(Decimal(stake) * real_odds)

    try:
        with db_transaction.atomic():
            wallet = Wallet.objects.select_for_update().get(user=request.user)
            if wallet.balance < stake:
                return Response(
                    {"error": f"Insufficient balance. Need {stake}, have {wallet.balance}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            balance_before = wallet.balance
            wallet.balance -= stake
            # Count cricket stakes toward turnover unlock rules when field exists
            if hasattr(wallet, "turnover"):
                wallet.turnover = (wallet.turnover or 0) + stake
                wallet.save(update_fields=["balance", "turnover", "updated_at"])
            else:
                wallet.save(update_fields=["balance", "updated_at"])

            bet = CricketBet.objects.create(
                user=request.user,
                event_id=event_id,
                event_name=event_name[:255],
                market_id=market_id,
                market_name=market_name[:255],
                outcome_id=outcome_id,
                outcome_name=outcome_name[:255],
                odds=real_odds,
                stake=stake,
                potential_payout=potential_payout,
                status="PENDING",
            )

            Txn.objects.create(
                user=request.user,
                transaction_type="BET",
                amount=-stake,
                balance_before=balance_before,
                balance_after=wallet.balance,
                description=(
                    f"Cricket bet #{bet.id}: {event_name} / {market_name} / "
                    f"{outcome_name} @ {real_odds}"
                ),
            )

        return Response(
            {
                "id": bet.id,
                "event_id": bet.event_id,
                "event_name": bet.event_name,
                "market_id": bet.market_id,
                "market_name": bet.market_name,
                "outcome_id": bet.outcome_id,
                "outcome_name": bet.outcome_name,
                "odds": str(bet.odds),
                "stake": int(bet.stake),
                "potential_payout": int(bet.potential_payout),
                "status": bet.status,
                "created_at": bet.created_at.isoformat(),
                "wallet_balance": wallet.balance,
            },
            status=status.HTTP_201_CREATED,
        )

    except Wallet.DoesNotExist:
        return Response({"error": "Wallet not found"}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        logger.exception("place_cricket_bet error: %s", exc)
        return Response(
            {"error": "Failed to place bet"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_cricket_bets(request):
    """
    GET /api/cricket/bets/
    Authenticated user's cricket bet history (most recent first).
    """
    from game.models import CricketBet

    bets = CricketBet.objects.filter(user=request.user).order_by("-created_at")[:50]
    return Response({
        "bets": [
            {
                "id": b.id,
                "event_id": b.event_id,
                "event_name": b.event_name,
                "market_id": b.market_id,
                "market_name": b.market_name,
                "outcome_id": b.outcome_id,
                "outcome_name": b.outcome_name,
                "odds": str(b.odds),
                "stake": int(b.stake) if b.stake is not None else 0,
                "potential_payout": int(b.potential_payout) if b.potential_payout is not None else 0,
                "status": b.status,
                "payout_amount": int(b.payout_amount) if b.payout_amount is not None else 0,
                "created_at": b.created_at.isoformat(),
                "settled_at": b.settled_at.isoformat() if b.settled_at else None,
            }
            for b in bets
        ]
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def cricket_results(request):
    """
    GET /api/cricket/results/
    GET /api/cricket/results/?event_id=123
    GET /api/cricket/results/?refresh=true

    Clean settlement results copied from Dafabet outcome.result.
    Only final results (WIN / LOSE / VOID) are returned.

    This is the source used to settle cricket bets.
    """
    from game.models import CricketOutcomeResult

    force = request.GET.get("refresh", "false").lower() == "true"
    if force:
        refresh_pending_bet_results()

    event_id = request.GET.get("event_id")
    cached = _cache_get(REDIS_KEY_RESULTS)
    if cached is None or event_id:
        qs = CricketOutcomeResult.objects.filter(is_final=True).order_by("-updated_at")
        if event_id:
            try:
                qs = qs.filter(event_id=int(event_id))
            except (TypeError, ValueError):
                return Response(
                    {"error": "event_id must be an integer"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        by_event: dict[int, dict] = {}
        for r in qs[:500]:
            ev = by_event.setdefault(r.event_id, {
                "event_id": r.event_id,
                "event_name": r.event_name,
                "markets": {},
            })
            mk = ev["markets"].setdefault(r.market_id, {
                "market_id": r.market_id,
                "market_name": r.market_name,
                "market_status": r.market_status,
                "settled": True,
                "outcomes": [],
            })
            mk["outcomes"].append({
                "outcome_id": r.outcome_id,
                "outcome_name": r.outcome_name,
                "result": r.result_code,
                "result_raw": r.raw_result or None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            })
        results = [
            {
                "event_id": ev["event_id"],
                "event_name": ev["event_name"],
                "markets": list(ev["markets"].values()),
            }
            for ev in by_event.values()
        ]
        if not event_id:
            _cache_set(REDIS_KEY_RESULTS, results, 300)
    else:
        results = cached

    return Response({
        "count": len(results),
        "source": "dafa_outcome_result",
        "settlement_rule": "Bets settle only when outcome.result is WIN, LOSE, or VOID",
        "results": results,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cricket_settle_now(request):
    """
    POST /api/cricket/settle/
    Admin/ops helper: refresh pending-bet results from Dafa and settle bets.
    Restricted to staff users.
    """
    if not (request.user.is_staff or request.user.is_superuser):
        return Response({"error": "Staff only"}, status=status.HTTP_403_FORBIDDEN)

    summary = refresh_pending_bet_results()
    return Response({"ok": True, **summary})
