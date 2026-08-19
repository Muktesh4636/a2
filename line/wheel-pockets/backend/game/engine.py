"""Wheel of Pockets — 15 segments with ratios on the wheel."""
from __future__ import annotations
import random
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

PURPLE = '#7c3aed'
BLUE = '#1d4ed8'
GREEN = '#16a34a'
GOLD = '#eab308'
RED = '#dc2626'

@dataclass(frozen=True)
class Pocket:
    id: str
    multiplier: float
    color: str
    start: float
    span: float
    weight: int

DEFS = (
    ('p100', 100.0, PURPLE, 1),
    ('b2a', 2.0, BLUE, 12),
    ('g5a', 5.0, GREEN, 4),
    ('y15a', 1.5, GOLD, 14),
    ('r3a', 3.0, RED, 7),
    ('b2b', 2.0, BLUE, 12),
    ('p10', 10.0, PURPLE, 2),
    ('y15b', 1.5, GOLD, 14),
    ('g25a', 2.5, GREEN, 8),
    ('r4', 4.0, RED, 5),
    ('b2c', 2.0, BLUE, 12),
    ('p12', 1.2, PURPLE, 16),
    ('y3', 3.0, GOLD, 7),
    ('g5b', 5.0, GREEN, 4),
    ('r15', 1.5, RED, 14),
)

STEP = 360.0 / len(DEFS)
POCKETS = tuple(
    Pocket(id=d[0], multiplier=d[1], color=d[2], start=i * STEP, span=STEP, weight=d[3])
    for i, d in enumerate(DEFS)
)


def money(v) -> Decimal:
    return Decimal(v).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def pick() -> Pocket:
    return random.choices(POCKETS, weights=[p.weight for p in POCKETS], k=1)[0]


def resolve_play(bet: Decimal) -> dict:
    p = pick()
    jitter = (random.random() - 0.5) * (p.span * 0.55)
    center = p.start + p.span / 2 + jitter
    mult = money(p.multiplier)
    return {
        'pocket_id': p.id,
        'color': p.color,
        'multiplier': mult,
        'payout': money(bet * mult),
        'target_angle': center % 360,
    }
