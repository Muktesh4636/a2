"""
Open-source / public live cricket scores (Cricbuzz HTML scrape).

Dafabet remains the betting/odds source. This module is a secondary
score feed for live runs/wickets/overs (+ batsmen/bowlers when available).

Notes
-----
- Unofficial: scrapes publicly rendered Cricbuzz pages (no paid API key).
- Ball-by-ball commentary is NOT always present in the list page; we expose
  overs/runs/wickets from matchScore + richer miniscore from the match page.
- Cache key: cricket:opensource_scores
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

import requests

from django.core.cache import cache

logger = logging.getLogger("game")

REDIS_KEY = "cricket:opensource_scores"
REDIS_KEY_TS = "cricket:opensource_last_sync"
REDIS_TTL = 45

_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
    "Mobile/15E148 Safari/604.1"
)
_HEADERS = {
    "User-Agent": _UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_LIVE_STATES = {"In Progress", "Innings Break", "Toss", "Rain", "Delay"}


def _http_get(url: str, timeout: float = 15.0) -> str | None:
    try:
        r = requests.get(url, headers=_HEADERS, timeout=timeout)
        if r.status_code != 200:
            logger.warning("opensource cricket GET %s -> %s", url, r.status_code)
            return None
        return r.text
    except Exception as exc:
        logger.warning("opensource cricket GET failed %s: %s", url, exc)
        return None


def _unescape_json_fragment(escaped: str) -> str:
    # Cricbuzz embeds JSON inside Next.js RSC strings as \"key\":...
    return escaped.replace('\\"', '"').replace("\\\\", "\\")


def _loads_escaped_object(escaped: str) -> dict | None:
    try:
        return json.loads(_unescape_json_fragment(escaped))
    except Exception:
        try:
            return json.loads(bytes(escaped, "utf-8").decode("unicode_escape"))
        except Exception:
            return None


def _extract_match_blocks(html: str) -> list[dict]:
    """Pull {matchInfo, matchScore?} objects from Cricbuzz live-scores HTML."""
    parts = re.findall(
        r'\{\\"matchInfo\\":\{.*?\}(?:,\\"matchScore\\":\{.*?\})?\}',
        html,
    )
    out: list[dict] = []
    seen: set[int] = set()
    for part in parts:
        obj = _loads_escaped_object(part)
        if not isinstance(obj, dict):
            continue
        info = obj.get("matchInfo") or {}
        if not isinstance(info, dict):
            continue
        mid = info.get("matchId")
        if not mid or mid in seen:
            continue
        seen.add(mid)
        out.append(obj)
    return out


def _team_score(block: dict | None) -> dict | None:
    if not isinstance(block, dict):
        return None
    # Prefer latest innings key (inngs1 / inngs2…)
    innings = [v for k, v in block.items() if k.startswith("inngs") and isinstance(v, dict)]
    if not innings:
        return None
    innings.sort(key=lambda x: x.get("inningsId") or 0)
    last = innings[-1]
    return {
        "innings_id": last.get("inningsId"),
        "runs": last.get("runs"),
        "wickets": last.get("wickets"),
        "overs": last.get("overs"),
        "is_declared": last.get("isDeclared", False),
        "balls": last.get("balls") or last.get("ballNbr"),
    }


def _simplify_list_match(obj: dict) -> dict:
    info = obj.get("matchInfo") or {}
    score = obj.get("matchScore") or {}
    t1 = info.get("team1") or {}
    t2 = info.get("team2") or {}
    return {
        "source": "cricbuzz",
        "id": info.get("matchId"),
        "series_id": info.get("seriesId"),
        "series": info.get("seriesName"),
        "description": info.get("matchDesc"),
        "format": info.get("matchFormat"),
        "state": info.get("state"),
        "status": info.get("status"),
        "state_title": info.get("stateTitle") or info.get("shortStatus"),
        "team1": {
            "id": t1.get("teamId"),
            "name": t1.get("teamName"),
            "short": t1.get("teamSName"),
            "score": _team_score(score.get("team1Score")),
        },
        "team2": {
            "id": t2.get("teamId"),
            "name": t2.get("teamName"),
            "short": t2.get("teamSName"),
            "score": _team_score(score.get("team2Score")),
        },
        "match": f"{t1.get('teamSName') or t1.get('teamName')} vs {t2.get('teamSName') or t2.get('teamName')}",
        "url": f"https://www.cricbuzz.com/live-cricket-scores/{info.get('matchId')}",
    }


def _extract_balanced_object(html: str, marker: str) -> dict | None:
    """Find escaped JSON object after marker like \\\"miniscore\\\":"""
    idx = html.find(marker)
    if idx < 0:
        return None
    start = html.find("{", idx)
    if start < 0:
        return None
    # Work on a limited window then unescape
    window = html[start : start + 12000]
    s = _unescape_json_fragment(window)
    depth = 0
    end = None
    in_str = False
    esc = False
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        return None
    try:
        obj = json.loads(s[:end])
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _player_brief(p: dict | None) -> dict | None:
    if not isinstance(p, dict) or not p.get("name"):
        return None
    return {
        "id": p.get("id"),
        "name": p.get("name"),
        "runs": p.get("runs"),
        "balls": p.get("balls"),
        "fours": p.get("fours"),
        "sixes": p.get("sixes"),
        "strike_rate": p.get("strikeRate"),
        "wickets": p.get("wickets"),
        "overs": p.get("overs"),
        "runs_conceded": p.get("runs"),
        "economy": p.get("economy") or p.get("runsPerBall"),
    }


def fetch_match_miniscore(match_id: int) -> dict | None:
    """Fetch richer live details from a single match page."""
    html = _http_get(f"https://www.cricbuzz.com/live-cricket-scores/{match_id}")
    if not html:
        return None
    mini = _extract_balanced_object(html, '\\"miniscore\\"')
    if not mini:
        mini = _extract_balanced_object(html, '"miniscore"')
    if not mini:
        return None

    bat = mini.get("batTeam") or {}
    overs_raw = mini.get("overs")
    # Hundred / balls formats sometimes use ball count in overs field
    current_over = None
    current_ball = None
    try:
        if isinstance(overs_raw, (int, float)) and overs_raw > 50:
            # likely balls faced (Hundred)
            balls = int(overs_raw)
            current_over = balls // 6
            current_ball = balls % 6
        elif isinstance(overs_raw, (int, float)):
            whole = int(overs_raw)
            frac = round((float(overs_raw) - whole) * 10)
            # 16.4 => over 16, ball 4
            current_over = whole
            current_ball = int(frac) if frac < 6 else 0
        elif isinstance(overs_raw, str) and "." in overs_raw:
            a, b = overs_raw.split(".", 1)
            current_over = int(a)
            current_ball = int(b)
    except Exception:
        pass

    return {
        "innings_id": mini.get("inningsId"),
        "status": mini.get("status"),
        "overs": overs_raw,
        "current_over": current_over,
        "current_ball": current_ball,
        "target": mini.get("target"),
        "rem_runs_to_win": mini.get("remRunsToWin"),
        "last_wicket": mini.get("lastWicket"),
        "crr": mini.get("crr") or (mini.get("partnerShip") or {}).get("crr"),
        "rrr": mini.get("rrr"),
        "bat_team": {
            "id": bat.get("teamId"),
            "runs": bat.get("teamScore"),
            "wickets": bat.get("teamWkts"),
        },
        "batsman_striker": _player_brief(mini.get("batsmanStriker")),
        "batsman_non_striker": _player_brief(mini.get("batsmanNonStriker")),
        "bowler_striker": _player_brief(mini.get("bowlerStriker")),
        "bowler_non_striker": _player_brief(mini.get("bowlerNonStriker")),
        "latest_performance": mini.get("latestPerformance"),
        "source": "cricbuzz_miniscore",
    }


def fetch_opensource_live_scores(enrich_live: bool = True, max_enrich: int = 8) -> dict[str, Any]:
    """
    Scrape Cricbuzz live-scores. Optionally enrich in-progress matches
    with miniscore (batsmen/bowlers/over.ball).
    """
    html = _http_get("https://www.cricbuzz.com/cricket-match/live-scores")
    if not html:
        return {"ok": False, "error": "fetch_failed", "matches": []}

    blocks = _extract_match_blocks(html)
    matches = [_simplify_list_match(b) for b in blocks]

    live = [m for m in matches if m.get("state") in _LIVE_STATES]
    if enrich_live:
        for m in live[:max_enrich]:
            try:
                detail = fetch_match_miniscore(int(m["id"]))
                if detail:
                    m["live"] = detail
                    # Convenience flat score line
                    bt = detail.get("bat_team") or {}
                    if bt.get("runs") is not None:
                        m["score_line"] = (
                            f"{bt.get('runs')}/{bt.get('wickets')} ({detail.get('overs')})"
                        )
            except Exception as exc:
                logger.debug("miniscore enrich failed for %s: %s", m.get("id"), exc)

    payload = {
        "ok": True,
        "source": "cricbuzz",
        "fetched_at": int(time.time()),
        "match_count": len(matches),
        "live_count": len(live),
        "matches": matches,
        "live_matches": live,
    }
    try:
        cache.set(REDIS_KEY, json.dumps(payload), timeout=REDIS_TTL)
        cache.set(REDIS_KEY_TS, str(payload["fetched_at"]), timeout=REDIS_TTL * 4)
    except Exception as exc:
        logger.warning("opensource cricket cache write failed: %s", exc)
    return payload


def get_cached_opensource_scores(force_refresh: bool = False) -> dict[str, Any]:
    if not force_refresh:
        try:
            raw = cache.get(REDIS_KEY)
            if raw:
                data = json.loads(raw) if isinstance(raw, str) else raw
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return fetch_opensource_live_scores()
