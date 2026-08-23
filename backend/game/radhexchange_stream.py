"""
Resolve Radhe Exchange live TV for a sports event.

Flow (mirrors radhexchange.com player):
  1. Demo login → JWT on api.radhexchange.com
  2. GET /api/client/stream/{event_id} → HTML with channel id (e.g. 7102)
  3. Build premiumodds embed iframe URL (ftLivetvData + channel)
  4. Optionally resolve HLS via premiumodds score-api (when stream is live)
"""

from __future__ import annotations

import difflib
import hashlib
import json
import logging
import os
import random
import re
import time
from typing import Any

import requests

logger = logging.getLogger("game")

API_BASE = os.environ.get("RADHE_API_BASE", "https://api.radhexchange.com")
DOMAIN = os.environ.get("RADHE_DOMAIN", "radhexchange.com")
DEMO_USER = os.environ.get("RADHE_DEMO_USER", "Demo123")
DEMO_PASS = os.environ.get("RADHE_DEMO_PASS", "123456")

FT_LIVETV_BASE = os.environ.get(
    "RADHE_LIVETV_BASE",
    "https://premiumodds.cc/score/f50d78a6b623eb7d72eb4bf79800e0217e6b401d/",
)
PREMIUM_TOKEN = FT_LIVETV_BASE.rstrip("/").split("/")[-1]
PREMIUM_API = "https://premiumodds.cc/score-api/score/get-by-score"
AES_KEY = "Shubham.711"
HLS_DESYNC = 300
HLS_LIFETIME = 3600 * 3
RELAY_HLS_BASE = os.environ.get("SPORTS_LIVE_HLS_BASE", "https://gunduata.tech/sports-live").rstrip("/")

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Origin": "https://radhexchange.com",
    "Referer": "https://radhexchange.com/",
}

_token_cache: dict[str, Any] = {"token": None, "expires_at": 0}

REDIS_KEY_RADHE_TV = "radhe:live_tv"
REDIS_TTL_RADHE_TV = 60

# Radhe Exchange event_type_id → platform sport slug
RADHE_SPORT_BY_TYPE = {
    1: "soccer",
    2: "tennis",
    4: "cricket",
}
RADHE_TYPE_BY_SPORT = {v: k for k, v in RADHE_SPORT_BY_TYPE.items()}


def _get_auth_token() -> str:
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]

    r = requests.post(
        f"{API_BASE}/api/auth",
        json={"username": DEMO_USER, "password": DEMO_PASS, "domain": DOMAIN},
        headers={**_HEADERS, "Content-Type": "application/json"},
        timeout=20,
    )
    r.raise_for_status()
    data = r.json()["data"]
    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = now + int(data.get("expires_in", 3600))
    return _token_cache["token"]


def _channel_from_stream_html(html: str) -> str | None:
    m = re.search(r"get_tv2_url/(\d+)/", html)
    return m.group(1) if m else None


def _embed_url(channel: str) -> str:
    base = FT_LIVETV_BASE if FT_LIVETV_BASE.endswith("/") else FT_LIVETV_BASE + "/"
    return f"{base}{channel}"


def _relay_hls_url(event_id: str | int) -> str:
    return f"{RELAY_HLS_BASE}/{event_id}/stream.m3u8"


def _evp_bytes_to_key(password: bytes, salt: bytes, key_len: int, iv_len: int):
    from Crypto.Cipher import AES  # noqa: F401 — checked at decrypt time

    d = d_i = b""
    while len(d) < key_len + iv_len:
        d_i = hashlib.md5(d_i + password + salt).digest()
        d += d_i
    return d[:key_len], d[key_len : key_len + iv_len]


def _decrypt_premium_model(encrypted_b64: str) -> dict | None:
    try:
        from Crypto.Cipher import AES
    except ImportError:
        logger.warning("pycryptodome not installed; cannot decrypt premiumodds payload")
        return None

    import base64

    raw = base64.b64decode(encrypted_b64)
    if raw[:8] != b"Salted__":
        return None
    salt, ciphertext = raw[8:16], raw[16:]
    key, iv = _evp_bytes_to_key(AES_KEY.encode(), salt, 32, 16)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    plain = cipher.decrypt(ciphertext)
    pad = plain[-1]
    plain = plain[: -pad]
    return json.loads(plain.decode("utf-8"))


def _generate_hls_token(channel: str, ip: str) -> str:
    start = int(time.time()) - HLS_DESYNC
    end = start + HLS_LIFETIME
    rand = "".join(f"{random.randint(0, 255):02x}" for _ in range(16))
    payload = f"{channel}{ip}{start}{end}{AES_KEY}{rand}"
    sha = hashlib.sha1(payload.encode()).hexdigest()
    return f"{sha}-{rand}-{end}-{start}"


def _resolve_hls(channel: str, relay_ip: str) -> str | None:
    body = {
        "channel": str(channel),
        "token": PREMIUM_TOKEN,
        "referrerDomain": DOMAIN,
        "countryCode": "IN",
        "ip": relay_ip,
    }
    headers = {
        **_HEADERS,
        "Content-Type": "application/json",
        "Referer": _embed_url(channel),
    }
    try:
        r = requests.post(PREMIUM_API, json=body, headers=headers, timeout=15)
        r.raise_for_status()
        payload = r.json()
    except Exception as exc:
        logger.debug("premiumodds get-by-score failed: %s", exc)
        return _resolve_hls_via_node(channel, relay_ip)

    if not payload.get("model"):
        return None

    decrypted = _decrypt_premium_model(payload["model"])
    if not decrypted:
        return _resolve_hls_via_node(channel, relay_ip)

    match = decrypted.get("matchData") or {}
    player = decrypted.get("playerUser") or {}
    if match.get("streamSoon") or match.get("eventEnd"):
        return None

    hls_domain = (player.get("hlsDomain") or "").rstrip("/")
    if not hls_domain:
        return None

    token = _generate_hls_token(channel, relay_ip)
    return (
        f"{hls_domain}/{channel}/index.m3u8"
        f"?user={PREMIUM_TOKEN}&token={token}&ip={relay_ip}"
    )


def _resolve_hls_via_node(channel: str, relay_ip: str) -> str | None:
    import subprocess
    from pathlib import Path

    script = Path(__file__).resolve().parents[2] / "tools" / "sports-live" / "resolve_stream.js"
    if not script.exists():
        return None
    try:
        out = subprocess.check_output(
            ["node", str(script), "--channel", str(channel), relay_ip],
            text=True,
            timeout=30,
            cwd=str(script.parent),
        )
        data = json.loads(out.strip().splitlines()[-1])
        return data.get("hls_upstream")
    except Exception as exc:
        logger.debug("node hls resolve failed: %s", exc)
        return None


def resolve_radhe_stream(
    event_id: str | int,
    relay_ip: str | None = None,
    *,
    channel_id: str | int | None = None,
) -> dict[str, Any]:
    """
    Return embed + optional upstream HLS for a Radhe Exchange event id.
    Pass channel_id when already known from the event list to skip stream HTML.
    """
    event_id = str(event_id).strip()
    relay_ip = relay_ip or os.environ.get("SPORTS_LIVE_RELAY_IP", "72.61.254.71")

    channel = str(channel_id).strip() if channel_id else None
    if not channel:
        token = _get_auth_token()
        r = requests.get(
            f"{API_BASE}/api/client/stream/{event_id}",
            headers={**_HEADERS, "Authorization": f"bearer {token}"},
            timeout=20,
        )
        r.raise_for_status()
        channel = _channel_from_stream_html(r.text)

    if not channel:
        return {
            "ok": False,
            "event_id": event_id,
            "error": "no_tv_channel",
            "message": "Live TV channel not found for this event",
        }

    embed = _embed_url(channel)
    hls_upstream = _resolve_hls(channel, relay_ip)

    return {
        "ok": True,
        "event_id": event_id,
        "channel_id": channel,
        "embed_url": embed,
        "hls_upstream": hls_upstream,
        "relay_hls_url": _relay_hls_url(event_id),
        "premium_token": PREMIUM_TOKEN,
    }


# ---------------------------------------------------------------------------
# Radhe in-play event list (all sports with TV channels)
# ---------------------------------------------------------------------------

def _redis():
    try:
        from game.utils import get_redis_client
        return get_redis_client()
    except Exception:
        return None


def _cache_get(key: str):
    try:
        r = _redis()
        if r is None:
            return None
        raw = r.get(key)
        return json.loads(raw) if raw else None
    except Exception as exc:
        logger.debug("radhe cache read error [%s]: %s", key, exc)
        return None


def _cache_set(key: str, value, ttl: int = REDIS_TTL_RADHE_TV):
    try:
        r = _redis()
        if r is None:
            return
        r.setex(key, ttl, json.dumps(value, default=str))
    except Exception as exc:
        logger.debug("radhe cache write error [%s]: %s", key, exc)


def _normalize_match_name(name: str) -> str:
    s = (name or "").lower().strip()
    s = re.sub(r"\bvs\.?\b", " v ", s)
    s = re.sub(r"\bv\.?\b", " v ", s)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _name_tokens(name: str) -> set[str]:
    stop = {
        "v", "vs", "the", "fc", "sc", "cf", "afc", "city", "united",
        "town", "club", "de", "la", "el", "and", "at",
    }
    return {t for t in _normalize_match_name(name).split() if t and t not in stop}


def _split_teams(name: str) -> tuple[str, str]:
    n = _normalize_match_name(name)
    for sep in (" v ", " vs "):
        if sep in f" {n} ":
            parts = re.split(r"\s+v\s+|\s+vs\s+", n, maxsplit=1)
            if len(parts) == 2:
                return parts[0].strip(), parts[1].strip()
    return n, ""


def _team_match_score(team_a: str, team_b: str) -> float:
    if not team_a or not team_b:
        return 0.0
    na, nb = _normalize_match_name(team_a), _normalize_match_name(team_b)
    if na == nb or (len(na) >= 4 and na in nb) or (len(nb) >= 4 and nb in na):
        return 1.0
    ta, tb = _name_tokens(team_a), _name_tokens(team_b)
    if not ta or not tb:
        return difflib.SequenceMatcher(None, na, nb).ratio()

    short_tokens, long_text = (ta, nb) if len(na) <= len(nb) else (tb, na)
    hits = 0.0
    for t in short_tokens:
        if len(t) < 3:
            continue
        if t in long_text:
            hits += 1.0 if len(t) >= 5 else 0.7
    if hits:
        return min(1.0, hits / max(len(short_tokens), 1))

    overlap = len(ta & tb) / min(len(ta), len(tb))
    ratio = difflib.SequenceMatcher(None, na, nb).ratio()
    return max(overlap, ratio)


def _match_pair_score(platform_name: str, radhe_name: str) -> float:
    pa, pb = _split_teams(platform_name)
    ra, rb = _split_teams(radhe_name)
    if pa and pb and ra and rb:
        direct = (_team_match_score(pa, ra) + _team_match_score(pb, rb)) / 2
        flipped = (_team_match_score(pa, rb) + _team_match_score(pb, ra)) / 2
        return max(direct, flipped)
    return _name_similarity(platform_name, radhe_name)


def _score_radhe_event(
    ev: dict,
    *,
    match_name: str = "",
    competition: str = "",
    team_names: list[str] | None = None,
) -> float:
    radhe_name = ev.get("name") or ""
    score = 0.0
    if match_name:
        score = max(score, _match_pair_score(match_name, radhe_name))
    if competition:
        score = max(score, _name_similarity(competition, radhe_name))
        score = max(score, _match_pair_score(competition, radhe_name))
    if team_names and len(team_names) >= 2:
        synthetic = f"{team_names[0]} v {team_names[1]}"
        score = max(score, _match_pair_score(synthetic, radhe_name))
    return score


def _name_similarity(a: str, b: str) -> float:
    na, nb = _normalize_match_name(a), _normalize_match_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ratio = difflib.SequenceMatcher(None, na, nb).ratio()
    ta, tb = _name_tokens(a), _name_tokens(b)
    if ta and tb:
        overlap = len(ta & tb) / max(len(ta), len(tb))
        ratio = max(ratio, overlap)
    return ratio


def _radhe_event_payload(raw: dict) -> dict[str, Any]:
    channel = str(raw.get("tv_channel") or "").strip()
    sport = RADHE_SPORT_BY_TYPE.get(int(raw.get("event_type_id") or 0), "unknown")
    return {
        "radhe_event_id": raw.get("event_id"),
        "name": raw.get("name") or "",
        "sport": sport,
        "event_type_id": raw.get("event_type_id"),
        "in_play": bool(raw.get("in_play")),
        "channel_id": channel or None,
        "embed_url": _embed_url(channel) if channel else None,
        "relay_hls_url": _relay_hls_url(raw.get("event_id")) if raw.get("event_id") else None,
        "competition_id": raw.get("competition_id"),
        "open_date": raw.get("open_date"),
    }


def fetch_radhe_event_list() -> list[dict]:
    """Fetch all Radhe events (in-play + upcoming) with optional TV channels."""
    token = _get_auth_token()
    r = requests.get(
        f"{API_BASE}/api/client/event_list",
        headers={**_HEADERS, "Authorization": f"bearer {token}"},
        timeout=25,
    )
    r.raise_for_status()
    events = (r.json().get("data") or {}).get("events") or []
    return [_radhe_event_payload(e) for e in events if e.get("tv_channel")]


def sync_radhe_live_tv(*, force: bool = False) -> dict[str, Any]:
    """Refresh Redis cache of Radhe events that have TV channels."""
    if not force:
        cached = _cache_get(REDIS_KEY_RADHE_TV)
        if cached and cached.get("events"):
            return cached

    try:
        events = fetch_radhe_event_list()
        payload = {
            "synced_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "count": len(events),
            "events": events,
        }
        _cache_set(REDIS_KEY_RADHE_TV, payload, REDIS_TTL_RADHE_TV)
        return payload
    except Exception as exc:
        logger.warning("sync_radhe_live_tv failed: %s", exc)
        cached = _cache_get(REDIS_KEY_RADHE_TV)
        if cached:
            return cached
        raise


def get_radhe_live_tv_events(*, in_play_only: bool = False) -> list[dict]:
    data = sync_radhe_live_tv()
    events = data.get("events") or []
    if in_play_only:
        events = [e for e in events if e.get("in_play")]
    return events


def lookup_radhe_tv(
    match_name: str = "",
    *,
    sport: str | None = None,
    competition: str | None = None,
    in_play_only: bool = True,
    team_names: list[str] | None = None,
) -> dict[str, Any] | None:
    """
    Find the best Radhe TV feed for a platform match by name / competition.
    """
    events = get_radhe_live_tv_events(in_play_only=in_play_only)
    if sport:
        sport = sport.lower().strip()
        type_id = RADHE_TYPE_BY_SPORT.get(sport)
        if type_id is not None:
            events = [e for e in events if e.get("event_type_id") == type_id]

    if not events:
        return None

    candidates: list[tuple[float, dict]] = []
    for ev in events:
        score = _score_radhe_event(
            ev,
            match_name=match_name,
            competition=competition or "",
            team_names=team_names,
        )
        if score >= 0.45:
            candidates.append((score, ev))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[0], reverse=True)
    best_score, best = candidates[0]
    return {
        **best,
        "match_score": round(best_score, 3),
    }


def live_tv_for_match(
    match: dict,
    *,
    sport: str,
    in_play_only: bool = True,
) -> dict[str, Any] | None:
    """Attach Radhe live TV metadata to a platform match dict."""
    team_names = [s.get("team") for s in (match.get("scores") or []) if s.get("team")]
    hit = lookup_radhe_tv(
        match.get("match") or match.get("match_name") or "",
        sport=sport,
        competition=match.get("competition") or "",
        in_play_only=in_play_only,
        team_names=team_names,
    )
    if not hit:
        return None
    return {
        "radhe_event_id": hit.get("radhe_event_id"),
        "channel_id": hit.get("channel_id"),
        "embed_url": hit.get("embed_url"),
        "relay_hls_url": hit.get("relay_hls_url"),
        "in_play": hit.get("in_play"),
        "match_score": hit.get("match_score"),
    }
