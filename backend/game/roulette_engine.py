"""
Shared roulette round clock (Redis) — same game for every user.

Phases:
  betting  → 7s open for bets (yellow timer on clients)
  spinning → shared number already drawn; clients animate
  result   → zoom / result display window
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

logger = logging.getLogger("game.roulette_engine")

PHASE_BETTING = "betting"
PHASE_SPINNING = "spinning"
PHASE_RESULT = "result"

BETTING_SECONDS = 7.0
SPINNING_SECONDS = 16.0  # ball race + land + lock
RESULT_SECONDS = 10.0  # zoom in + hold + zoom out

REDIS_KEY = "roulette:shared_state"
WINS_KEY_PREFIX = "roulette:wins:"


def _redis():
    from game.utils import get_redis_client

    return get_redis_client()


def _now() -> float:
    return time.time()


def default_state() -> dict[str, Any]:
    now = _now()
    return {
        "phase": PHASE_BETTING,
        "phase_ends_at": now + BETTING_SECONDS,
        "number": None,
        "last_number": None,
        "round": 1,
        "server_now": now,
    }


def load_state() -> dict[str, Any]:
    r = _redis()
    if not r:
        st = default_state()
        st["seconds_left"] = max(0.0, st["phase_ends_at"] - st["server_now"])
        return st
    raw = r.get(REDIS_KEY)
    if not raw:
        st = default_state()
        save_state(st)
        st["seconds_left"] = max(0.0, st["phase_ends_at"] - st["server_now"])
        return st
    try:
        st = json.loads(raw)
    except Exception:
        st = default_state()
        save_state(st)
    st["server_now"] = _now()
    st["seconds_left"] = max(0.0, float(st.get("phase_ends_at", st["server_now"])) - st["server_now"])
    return st


def save_state(st: dict[str, Any]) -> None:
    r = _redis()
    if not r:
        return
    payload = {
        "phase": st["phase"],
        "phase_ends_at": float(st["phase_ends_at"]),
        "number": st.get("number"),
        "last_number": st.get("last_number"),
        "round": int(st.get("round") or 1),
    }
    r.set(REDIS_KEY, json.dumps(payload))


def is_betting_open() -> bool:
    st = load_state()
    return st.get("phase") == PHASE_BETTING and st.get("seconds_left", 0) > 0.05


def set_user_win(round_id: int, user_id: int, win: int) -> None:
    r = _redis()
    if not r:
        return
    key = f"{WINS_KEY_PREFIX}{round_id}"
    r.hset(key, str(user_id), str(int(win)))
    r.expire(key, 600)


def get_user_win(round_id: int | None, user_id: int) -> int:
    if not round_id:
        return 0
    r = _redis()
    if not r:
        return 0
    raw = r.hget(f"{WINS_KEY_PREFIX}{round_id}", str(user_id))
    if raw is None:
        return 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def public_state(user=None) -> dict[str, Any]:
    st = load_state()
    out = {
        "phase": st.get("phase"),
        "phase_ends_at": st.get("phase_ends_at"),
        "seconds_left": st.get("seconds_left"),
        "number": st.get("number"),
        "last_number": st.get("last_number"),
        "round": st.get("round"),
        "server_now": st.get("server_now"),
        "betting_seconds": BETTING_SECONDS,
        "can_bet": st.get("phase") == PHASE_BETTING and st.get("seconds_left", 0) > 0.05,
    }
    if user is not None:
        out["win"] = get_user_win(st.get("round"), user.id)
    return out
