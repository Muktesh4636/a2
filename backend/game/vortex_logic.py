"""
Authoritative Vortex ring rules (server-side).

Rings are independent:
  Water (blue):  1.6X → 5X → 10X
  Earth (green): 2.5X → 7.7X → 16X → 28X → 45X
  Fire (red):    4X → 15X → 30X → 55X → 88X → 133X → 200X

Symbol effects:
  water  → advance blue only by exactly 1 sector
  earth  → advance green only by exactly 1 sector
           (2.5X → 7.7X → 16X → 28X → 45X, one break per leaf)
  fire   → advance red only by exactly 1 sector
  skull  → every ring with progress loses exactly 1 sector
  wind   → rings unchanged (stake still lost)
"""
from __future__ import annotations

import secrets
from decimal import Decimal, ROUND_HALF_UP

RINGS = {
    "water": {
        "label": "Water",
        "mults": [1.6, 5, 10],
        "bonus": [5, 7, 10],
        "bonus_max": 10,
    },
    "earth": {
        "label": "Earth",
        "mults": [2.5, 7.7, 16, 28, 45],
        "bonus": [15, 25, 35, 50],
        "bonus_max": 50,
    },
    "fire": {
        "label": "Fire",
        "mults": [4, 15, 30, 55, 88, 133, 200],
        "bonus": [50, 100, 200, 400, 799],
        "bonus_max": 799,
    },
}

DROP_TABLE = [
    ("earth", 22),
    ("water", 20),
    ("fire", 20),
    ("wind", 14),
    ("skull", 12),
]

_rng = secrets.SystemRandom()

RING_KEYS = ("water", "earth", "fire")


def money(n) -> Decimal:
    """Legacy decimal helper (keep for multiplier math)."""
    return Decimal(str(n)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def money_rupees(n) -> int:
    """Round to whole rupees (Gundu Wallet)."""
    return int(Decimal(str(n)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def current_mult(fill: dict, key: str) -> float:
    n = fill[key]
    if n <= 0:
        return 0.0
    mults = RINGS[key]["mults"]
    return float(mults[min(n, len(mults)) - 1])


def total_mult(fill: dict) -> float:
    return sum(current_mult(fill, k) for k in RING_KEYS)


def can_part(fill: dict) -> bool:
    return any(fill[k] >= 2 for k in RING_KEYS)


def part_amount(fill: dict, bet) -> int:
    total = Decimal("0")
    for key in RING_KEYS:
        n = fill[key]
        if n < 2:
            continue
        mults = RINGS[key]["mults"]
        last = Decimal(str(mults[min(n, len(mults)) - 1]))
        prev = Decimal(str(mults[min(n, len(mults)) - 2]))
        total += last - prev
    return money_rupees(Decimal(str(bet)) * total)


def pick_drop() -> str:
    total = sum(w for _, w in DROP_TABLE)
    r = _rng.uniform(0, total)
    for dtype, weight in DROP_TABLE:
        r -= weight
        if r <= 0:
            return dtype
    return DROP_TABLE[-1][0]


def parse_drop(drop: str) -> tuple[str | None, int]:
    """
    Returns (ring_key or None, steps).
    Always +1 sector for ring symbols (no double fills).
    """
    if drop in ("wind", "skull"):
        return None, 0
    # Legacy x2 names still map to the ring, but only advance 1 break
    base = drop[:-1] if drop.endswith("2") and drop[:-1] in RINGS else drop
    if base in RINGS:
        return base, 1
    return None, 0


def apply_advance(fill: dict, key: str, steps: int = 1) -> tuple[dict, bool, float | None]:
    """
    Advance ONE ring by exactly one sector (one break).
    Other rings are untouched.
    """
    fill = {k: fill[k] for k in RING_KEYS}
    max_sectors = len(RINGS[key]["mults"])
    before = fill[key]
    # Force single-break steps — never skip a multiplier
    after = min(max_sectors + 1, before + 1)
    fill[key] = after
    if after > max_sectors:
        return fill, True, None
    return fill, False, float(RINGS[key]["mults"][after - 1])


def apply_rollback(fill: dict) -> dict:
    """Skull: each ring loses exactly one sector; zero stays zero."""
    return {k: max(0, fill[k] - 1) for k in RING_KEYS}


def roll_bonus(key: str) -> float:
    return float(_rng.choice(RINGS[key]["bonus"]))


def format_mult(v: float) -> str:
    if float(v).is_integer():
        return str(int(v))
    return f"{v:g}"


def session_snapshot(
    session,
    balance: int,
    *,
    message: str | None = None,
    drop: str | None = None,
    extra: dict | None = None,
) -> dict:
    fill = {
        "water": session.water,
        "earth": session.earth,
        "fire": session.fire,
    }
    bet = int(session.bet)
    mult = total_mult(fill)
    payload = {
        "ok": True,
        "balance": int(balance),
        "bet": bet,
        "fill": fill,
        "ring_mults": {k: current_mult(fill, k) for k in RING_KEYS},
        "total_mult": round(mult, 4),
        "payout": money_rupees(bet * Decimal(str(mult))),
        "can_part": can_part(fill),
        "part_amount": part_amount(fill, bet) if can_part(fill) else 0,
        "has_progress": sum(fill.values()) > 0,
        "busy": session.busy,
        "rings": {
            k: {
                "label": v["label"],
                "mults": v["mults"],
                "bonus_max": v["bonus_max"],
            }
            for k, v in RINGS.items()
        },
    }
    if message is not None:
        payload["message"] = message
    if drop is not None:
        payload["drop"] = drop
    if extra:
        payload.update(extra)
    return payload
