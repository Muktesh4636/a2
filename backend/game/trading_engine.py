"""
Shared trading round clock (Redis) — same market for every user.

Phases:
  betting  → 7s open for UP/DOWN bets
  trading  → 10s live chart; cashout allowed
  result   → brief settle / flash window
"""

from __future__ import annotations

import json
import logging
import math
import random
import time
from typing import Any

logger = logging.getLogger("game.trading_engine")

PHASE_BETTING = "betting"
PHASE_TRADING = "trading"
PHASE_RESULT = "result"

BETTING_SECONDS = 7.0
TRADING_SECONDS = 13.0
RESULT_SECONDS = 2.5

REDIS_KEY = "trading:shared_state"
WINS_KEY_PREFIX = "trading:wins:"
CASHOUTS_KEY_PREFIX = "trading:cashouts:"


def _redis():
    from game.utils import get_redis_client

    return get_redis_client()


def _now() -> float:
    return time.time()


def pick_final_pct() -> float:
    r = random.random()
    if r < 0.40:
        pct = random.uniform(70, 95) * (1 if random.random() < 0.5 else -1)
    elif r < 0.75:
        pct = random.uniform(30, 70) * (1 if random.random() < 0.5 else -1)
    else:
        pct = random.uniform(8, 30) * (1 if random.random() < 0.5 else -1)
    return round(pct, 2)


def generate_crowd() -> dict:
    """
    Display lifeline totals so UP/DOWN looks like live betting.
    Each side ₹8,000–18,000 and never equal.
    """
    up = random.randint(8000, 18000)
    down = random.randint(8000, 18000)
    while abs(up - down) < 1200:
        down = random.randint(8000, 18000)
    up_players = random.randint(28, 72)
    down_players = random.randint(22, 68)
    if up > down and up_players <= down_players:
        up_players = down_players + random.randint(3, 10)
    elif down > up and down_players <= up_players:
        down_players = up_players + random.randint(3, 10)
    return {
        "up_amount": up,
        "down_amount": down,
        "up_players": up_players,
        "down_players": down_players,
    }


def seed_crowd() -> dict:
    """Alias used by the timer when opening a new betting window."""
    return {"crowd": generate_crowd()}


def nudge_crowd(st: dict) -> None:
    """Small live drift during betting so the lifeline keeps moving."""
    if st.get("phase") != PHASE_BETTING:
        return
    c = dict(st.get("crowd") or generate_crowd())
    heavy_up = c.get("up_amount", 0) >= c.get("down_amount", 0)
    bump_up = random.random() < (0.58 if heavy_up else 0.42)
    amt = random.randint(60, 520)
    if bump_up:
        c["up_amount"] = int(c.get("up_amount") or 8000) + amt
        if random.random() < 0.35:
            c["up_players"] = int(c.get("up_players") or 30) + 1
    else:
        c["down_amount"] = int(c.get("down_amount") or 8000) + amt
        if random.random() < 0.35:
            c["down_players"] = int(c.get("down_players") or 30) + 1
    if c["up_amount"] == c["down_amount"]:
        c["up_amount"] += random.randint(300, 900)
    st["crowd"] = c


def generate_path(final_pct: float, seed: int, n: int = 200) -> list[float]:
    """Single shared chart path — normal spikes only (no heavy ±22 jumps)."""
    rng = random.Random(seed)
    points: list[float] = []
    price = 0.0
    velocity = 0.0
    for i in range(n):
        progress = i / n
        mean_revert = -price * 0.04
        is_extreme = abs(final_pct) >= 70
        if progress > 0.95:
            pull = (final_pct - price) * 0.55
        elif progress > 0.75:
            pull = (final_pct - price) * (0.18 if is_extreme else 0.12)
        elif progress > 0.55:
            pull = (final_pct - price) * (0.06 if is_extreme else 0.03)
        else:
            pull = 0.0
        r = rng.random()
        # Normal spikes only — one consistent style for all clients
        if progress > 0.95:
            noise = rng.uniform(-0.4, 0.4)
        elif r > 0.97:
            noise = rng.uniform(-5.0, 5.0)   # mild spike (~3%)
        elif r > 0.88:
            noise = rng.uniform(-2.2, 2.2)   # medium flutter
        elif progress < 0.15:
            noise = rng.uniform(-2.0, 2.0)   # open lively
        else:
            noise = rng.uniform(-0.8, 0.8)   # micro flutter
        velocity = velocity * 0.75 + (mean_revert + pull + noise) * 0.25
        price = max(-95.0, min(95.0, price + velocity))
        points.append(round(price, 3))
    points.append(float(final_pct))
    return points


def sample_path(path: list[float], progress: float) -> float:
    if not path:
        return 0.0
    t = max(0.0, min(1.0, progress))
    if t >= 1.0:
        return float(path[-1])
    idx = t * (len(path) - 1)
    i = int(math.floor(idx))
    j = min(i + 1, len(path) - 1)
    u = idx - i
    return float(path[i] + (path[j] - path[i]) * u)


def default_state() -> dict[str, Any]:
    now = _now()
    return {
        "phase": PHASE_BETTING,
        "phase_ends_at": now + BETTING_SECONDS,
        "final_pct": None,
        "live_pct": 0.0,
        "path": [],
        "path_seed": 0,
        "last_pct": None,
        "round": 1,
        "server_now": now,
        "crowd": generate_crowd(),
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
    if not st.get("crowd"):
        st["crowd"] = generate_crowd()
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
        "final_pct": st.get("final_pct"),
        "live_pct": float(st.get("live_pct") or 0),
        "path": st.get("path") or [],
        "path_seed": int(st.get("path_seed") or 0),
        "last_pct": st.get("last_pct"),
        "round": int(st.get("round") or 1),
        "crowd": st.get("crowd") or generate_crowd(),
    }
    r.set(REDIS_KEY, json.dumps(payload))


def is_betting_open() -> bool:
    st = load_state()
    return st.get("phase") == PHASE_BETTING and st.get("seconds_left", 0) > 0.05


def is_trading_open() -> bool:
    st = load_state()
    return st.get("phase") == PHASE_TRADING and st.get("seconds_left", 0) > 0.05


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


def push_cashout_feed(round_id: int, username: str, mult: int, payout: int) -> None:
    r = _redis()
    if not r:
        return
    key = f"{CASHOUTS_KEY_PREFIX}{round_id}"
    entry = json.dumps({"name": username, "mult": mult, "amt": payout, "at": _now()})
    r.lpush(key, entry)
    r.ltrim(key, 0, 19)
    r.expire(key, 600)


def cashout_feed(round_id: int | None) -> list[dict]:
    if not round_id:
        return []
    r = _redis()
    if not r:
        return []
    rows = r.lrange(f"{CASHOUTS_KEY_PREFIX}{round_id}", 0, 7) or []
    out = []
    for raw in rows:
        try:
            out.append(json.loads(raw))
        except Exception:
            continue
    return out


def public_state(user=None) -> dict[str, Any]:
    st = load_state()
    crowd = st.get("crowd") or generate_crowd()
    out = {
        "phase": st.get("phase"),
        "phase_ends_at": st.get("phase_ends_at"),
        "seconds_left": st.get("seconds_left"),
        "final_pct": st.get("final_pct"),
        "live_pct": float(st.get("live_pct") or 0),
        "last_pct": st.get("last_pct"),
        "path": st.get("path") or [],
        "path_seed": st.get("path_seed") or 0,
        "round": st.get("round"),
        "server_now": st.get("server_now"),
        "betting_seconds": BETTING_SECONDS,
        "trading_seconds": TRADING_SECONDS,
        "can_bet": st.get("phase") == PHASE_BETTING and st.get("seconds_left", 0) > 0.05,
        "can_cashout": st.get("phase") == PHASE_TRADING and st.get("seconds_left", 0) > 0.05,
        "cashouts": cashout_feed(st.get("round")),
        "crowd": {
            "up_amount": int(crowd.get("up_amount") or 0),
            "down_amount": int(crowd.get("down_amount") or 0),
            "up_players": int(crowd.get("up_players") or 0),
            "down_players": int(crowd.get("down_players") or 0),
        },
    }
    if user is not None:
        out["win"] = get_user_win(st.get("round"), user.id)
    return out
