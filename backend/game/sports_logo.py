"""
Team / player logo lookup for sports UI.

DafaBet does not provide crest URLs. We resolve logos via TheSportsDB
(with Redis cache) and fall back to a generated SVG avatar.
"""

from __future__ import annotations

import hashlib
import logging
import re
import urllib.parse

import requests
from django.http import HttpResponse, HttpResponseRedirect
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from game import sports_feed as feed

logger = logging.getLogger("game")

_TSDB_KEY = "3"  # TheSportsDB free public test key
_TSDB_BASE = f"https://www.thesportsdb.com/api/v1/json/{_TSDB_KEY}"
_LOGO_TTL = 7 * 24 * 3600
_NEG_TTL = 6 * 3600

_SESSION = requests.Session()
_SESSION.headers.update({
    "User-Agent": "GunduAtaSportsLogo/1.0",
    "Accept": "application/json",
})

# Feed names that differ from TheSportsDB (renames / local branding).
_CRICKET_ALIASES = {
    "galle gallants": "Galle Marvels",
    "royal challengers bengaluru": "Royal Challengers Bangalore",
    "manchester super giants": "Manchester Originals",
    "manchester originals women": "Manchester Originals",
    "delhi capitals women": "Delhi Capitals",
    "mumbai indians women": "Mumbai Indians",
    "chennai super kings women": "Chennai Super Kings",
    "kolkata knight riders women": "Kolkata Knight Riders",
    "rajasthan royals women": "Rajasthan Royals",
    "sunrisers hyderabad women": "Sunrisers Hyderabad",
    "gujarat titans women": "Gujarat Titans",
    "lucknow super giants women": "Lucknow Super Giants",
    "punjab kings women": "Punjab Kings",
}

_SPORT_LABEL = {
    "cricket": "cricket",
    "soccer": "soccer",
    "football": "soccer",
    "tennis": "tennis",
}


def _norm_name(name: str) -> str:
    s = re.sub(r"\s+", " ", (name or "").strip())
    # Drop common suffixes that hurt search
    s = re.sub(r"\b(lfc|afc|fc|sc|cf|women|wfc)\b\.?", "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" -")
    return s


def _cache_key(sport: str, name: str) -> str:
    digest = hashlib.sha1(f"{sport}|{name.lower()}".encode()).hexdigest()[:24]
    return f"sports:logo:v2:{digest}"


def _svg_avatar(name: str, sport: str) -> bytes:
    initials = "".join(p[0] for p in re.findall(r"[A-Za-z0-9]+", name)[:2]).upper() or "?"
    colors = {
        "cricket": ("#1a2836", "#d4af37"),
        "soccer": ("#14261c", "#7dcea0"),
        "tennis": ("#241e14", "#f0d57a"),
    }
    bg, fg = colors.get(sport, ("#243041", "#d4af37"))
    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{bg}"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
  </defs>
  <circle cx="64" cy="64" r="64" fill="url(#g)"/>
  <circle cx="64" cy="64" r="60" fill="none" stroke="{fg}" stroke-opacity="0.35" stroke-width="3"/>
  <text x="64" y="72" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif"
        font-size="44" font-weight="700" fill="{fg}">{initials}</text>
</svg>"""
    return svg.encode("utf-8")


def _tsdb_get(path: str, params: dict) -> tuple[dict | None, bool]:
    """
    Returns (json_or_none, ok).
    ok=False means network/HTTP failure — caller must NOT negative-cache.
    """
    try:
        r = _SESSION.get(f"{_TSDB_BASE}/{path}", params=params, timeout=8)
        if r.status_code != 200:
            return None, False
        return r.json(), True
    except Exception as exc:
        logger.info("TheSportsDB error %s: %s", path, exc)
        return None, False


def _sport_bonus(team_sport: str, want: str) -> int:
    ts = (team_sport or "").lower()
    if want == "cricket":
        if "cricket" in ts:
            return 50
        if ts and "cricket" not in ts:
            return -40
    if want == "soccer":
        if ts in ("soccer", "football") or "soccer" in ts:
            return 50
        if ts and ts not in ("soccer", "football"):
            return -40
    return 0


def _pick_team_badge(teams: list, query: str, sport: str) -> str | None:
    if not teams:
        return None
    q = query.lower()
    scored = []
    for t in teams:
        name = (t.get("strTeam") or "").lower()
        alt = (t.get("strTeamAlternate") or "").lower()
        score = 0
        if name == q or alt == q:
            score = 100
        elif q in name or name in q:
            score = 80
        elif any(w and w in name for w in q.split()):
            score = 40
        score += _sport_bonus(t.get("strSport") or "", sport)
        badge = t.get("strBadge") or t.get("strTeamBadge") or t.get("strLogo")
        if badge and score > 0:
            scored.append((score, badge))
    if not scored:
        # Prefer same-sport badge even on weak match; never cross-sport.
        for t in teams:
            if _sport_bonus(t.get("strSport") or "", sport) < 0:
                continue
            badge = t.get("strBadge") or t.get("strTeamBadge") or t.get("strLogo")
            if badge:
                return badge
        return None
    scored.sort(key=lambda x: -x[0])
    return scored[0][1]


def _pick_player_thumb(players: list) -> str | None:
    for p in players or []:
        for key in ("strCutout", "strThumb", "strRender"):
            url = p.get(key)
            if url:
                return url
    return None


def _query_variants(clean: str, sport: str) -> list[str]:
    variants: list[str] = []
    alias = _CRICKET_ALIASES.get(clean.lower()) if sport == "cricket" else None
    if alias:
        variants.append(alias)
    variants.append(clean)
    # Strip trailing franchise fluff for a shorter search
    short = re.sub(
        r"\b(xi|team|club|united|city|warriors|kings|riders|titans|giants|super)\b\.?",
        "",
        clean,
        flags=re.I,
    )
    short = re.sub(r"\s+", " ", short).strip(" -")
    if short and short.lower() != clean.lower() and len(short) >= 4:
        variants.append(short)
    if " " in clean:
        variants.append(" ".join(clean.split()[:2]))
    # de-dupe preserving order
    seen = set()
    out = []
    for v in variants:
        k = v.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(v)
    return out


def resolve_logo_url(name: str, sport: str) -> str | None:
    sport = _SPORT_LABEL.get((sport or "soccer").lower().strip(), (sport or "soccer").lower().strip())
    clean = _norm_name(name)
    if not clean:
        return None

    key = _cache_key(sport, clean)
    cached = feed.cache_get(key)
    if isinstance(cached, dict) and "logo" in cached:
        return cached.get("logo") or None

    logo = None
    api_ok = True

    if sport == "tennis":
        variants = [clean]
        if "," in clean:
            last, first = [x.strip() for x in clean.split(",", 1)]
            variants.append(f"{first} {last}".strip())
        for v in variants:
            data, ok = _tsdb_get("searchplayers.php", {"p": v})
            api_ok = api_ok and ok
            if not ok:
                continue
            logo = _pick_player_thumb((data or {}).get("player") or [])
            if logo:
                break
    else:
        for v in _query_variants(clean, sport):
            data, ok = _tsdb_get("searchteams.php", {"t": v})
            api_ok = api_ok and ok
            if not ok:
                continue
            logo = _pick_team_badge((data or {}).get("teams") or [], v, sport)
            if logo:
                break

    # Only cache definitive results. Skip cache when upstream failed so
    # temporary TheSportsDB outages don't blank logos for hours.
    if logo:
        feed.cache_set(key, {"logo": logo}, _LOGO_TTL)
    elif api_ok:
        feed.cache_set(key, {"logo": None}, _NEG_TTL)

    return logo


@api_view(["GET"])
@permission_classes([AllowAny])
def team_logo(request):
    """
    GET /api/sports/team-logo/?name=Arsenal&sport=soccer

    Redirects to a crest/player image when found.
    With format=json returns {"name","sport","logo"}.
    With fallback=1 (default) serves an SVG avatar when no crest exists.
    """
    name = (request.GET.get("name") or "").strip()
    sport = (request.GET.get("sport") or "soccer").strip().lower()
    fmt = (request.GET.get("format") or "").strip().lower()
    fallback = (request.GET.get("fallback") or "1").strip() != "0"

    if not name:
        return Response({"error": "missing_param", "detail": "name is required"}, status=400)

    logo = resolve_logo_url(name, sport)

    if fmt == "json":
        return Response({"name": name, "sport": sport, "logo": logo})

    if logo:
        return HttpResponseRedirect(logo)

    if fallback:
        svg = _svg_avatar(name, sport)
        return HttpResponse(svg, content_type="image/svg+xml")

    return HttpResponse(status=204)
