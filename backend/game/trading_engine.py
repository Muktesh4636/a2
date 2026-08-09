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
TIMER_LOCK_KEY = "trading:timer_lock"
TIMER_HEARTBEAT_KEY = "trading:timer_heartbeat"

# Every app server runs a trading_game_timer container against the same Redis,
# so exactly one of them may drive the clock. The lock expires on its own, which
# keeps a dead leader from stalling the market for longer than LOCK_TTL_SECONDS.
LOCK_TTL_SECONDS = 10
HEARTBEAT_TTL_SECONDS = 15

# How far phase_ends_at may fall behind before the clock counts as stopped.
STALE_AFTER_SECONDS = 20.0

_RENEW_LOCK_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
"""

_RELEASE_LOCK_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


def _redis():
    from game.utils import get_redis_client

    return get_redis_client()


def redis_available() -> bool:
    return _redis() is not None


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


def _decorate(st: dict[str, Any], redis_down: bool = False) -> dict[str, Any]:
    if not st.get("crowd"):
        st["crowd"] = generate_crowd()
    now = _now()
    ends = float(st.get("phase_ends_at") or now)
    st["server_now"] = now
    st["seconds_left"] = max(0.0, ends - now)
    st["redis_down"] = redis_down
    st["stale"] = redis_down or (now - ends) > STALE_AFTER_SECONDS
    return st


def load_state() -> dict[str, Any]:
    r = _redis()
    if not r:
        return _decorate(default_state(), redis_down=True)
    raw = r.get(REDIS_KEY)
    if not raw:
        st = default_state()
        save_state(st)
        return _decorate(st)
    try:
        st = json.loads(raw)
    except Exception:
        st = default_state()
        save_state(st)
    return _decorate(st)


def _state_payload(st: dict[str, Any]) -> dict[str, Any]:
    return {
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


def save_state(st: dict[str, Any]) -> None:
    r = _redis()
    if not r:
        return
    r.set(REDIS_KEY, json.dumps(_state_payload(st)))


def save_state_cas(st: dict[str, Any], expect_phase: str, expect_round: int) -> bool:
    """
    Write state only if Redis still holds the phase/round this caller read.

    Phase changes must never be applied twice. Without this guard a second timer
    can rewind a round that already advanced, which restarts the chart mid-trade
    and makes the market look frozen or jumpy.
    """
    r = _redis()
    if not r:
        return False
    from redis.exceptions import WatchError

    payload = json.dumps(_state_payload(st))
    try:
        with r.pipeline() as pipe:
            for _ in range(3):
                try:
                    pipe.watch(REDIS_KEY)
                    raw = pipe.get(REDIS_KEY)
                    if raw:
                        try:
                            current = json.loads(raw)
                        except Exception:
                            current = {}
                        same_phase = current.get("phase") == expect_phase
                        same_round = int(current.get("round") or 1) == int(expect_round)
                        if not (same_phase and same_round):
                            pipe.unwatch()
                            return False
                    pipe.multi()
                    pipe.set(REDIS_KEY, payload)
                    pipe.execute()
                    return True
                except WatchError:
                    continue
        return False
    except Exception as exc:
        logger.warning("trading state CAS failed: %s", exc)
        return False


def acquire_timer_lock(token: str) -> bool:
    r = _redis()
    if not r:
        return False
    try:
        return bool(r.set(TIMER_LOCK_KEY, token, ex=LOCK_TTL_SECONDS, nx=True))
    except Exception as exc:
        logger.warning("trading timer lock acquire failed: %s", exc)
        return False


def renew_timer_lock(token: str) -> bool:
    r = _redis()
    if not r:
        return False
    try:
        return bool(r.eval(_RENEW_LOCK_LUA, 1, TIMER_LOCK_KEY, token, LOCK_TTL_SECONDS))
    except Exception as exc:
        logger.warning("trading timer lock renew failed: %s", exc)
        return False


def release_timer_lock(token: str) -> None:
    r = _redis()
    if not r:
        return
    try:
        r.eval(_RELEASE_LOCK_LUA, 1, TIMER_LOCK_KEY, token)
    except Exception as exc:
        logger.warning("trading timer lock release failed: %s", exc)


def write_heartbeat(token: str) -> None:
    r = _redis()
    if not r:
        return
    try:
        r.set(
            TIMER_HEARTBEAT_KEY,
            json.dumps({"owner": token, "at": _now()}),
            ex=HEARTBEAT_TTL_SECONDS,
        )
    except Exception as exc:
        logger.warning("trading heartbeat write failed: %s", exc)


def seconds_since_heartbeat(heartbeat: dict | None) -> float:
    if not heartbeat:
        return float("inf")
    try:
        return max(0.0, _now() - float(heartbeat.get("at") or 0))
    except (TypeError, ValueError):
        return float("inf")


def timer_heartbeat() -> dict | None:
    """Owner + timestamp of the live clock, or None when no timer is running."""
    r = _redis()
    if not r:
        return None
    try:
        raw = r.get(TIMER_HEARTBEAT_KEY)
    except Exception:
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


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
        "stale": bool(st.get("stale")),
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
