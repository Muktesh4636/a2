"""Spin Dial engine — always lands on a colored segment."""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass
from decimal import Decimal, ROUND_HALF_UP


@dataclass(frozen=True)
class Segment:
    id: str
    multiplier: float
    color: str
    angle: float
    span: float
    weight: int


SEGMENTS: tuple[Segment, ...] = (
    Segment('g1', 1.5, '#00e701', 165, 18, 14),
    Segment('y1', 2.0, '#fde047', 145, 18, 10),
    Segment('c1', 5.0, '#22d3ee', 125, 18, 2),
    Segment('w1', 1.8, '#ffffff', 105, 18, 6),
    Segment('y2', 2.0, '#fde047', 85, 18, 10),
    Segment('o1', 10.0, '#fb923c', 65, 18, 1),
    Segment('g2', 1.5, '#00e701', 45, 18, 14),
    Segment('p1', 3.0, '#a855f7', 25, 18, 4),
    Segment('y3', 2.0, '#fde047', 8, 14, 10),
)

OUTCOMES = (
    {'id': 'lose', 'multiplier': 0, 'color': '#3a4553', 'label': '0.00x'},
    {'id': 'green', 'multiplier': 1.5, 'color': '#00e701', 'label': '1.50x'},
    {'id': 'white', 'multiplier': 1.8, 'color': '#ffffff', 'label': '1.80x'},
    {'id': 'yellow', 'multiplier': 2, 'color': '#fde047', 'label': '2.00x'},
    {'id': 'purple', 'multiplier': 3, 'color': '#a855f7', 'label': '3.00x'},
    {'id': 'cyan', 'multiplier': 5, 'color': '#22d3ee', 'label': '5.00x'},
    {'id': 'orange', 'multiplier': 10, 'color': '#fb923c', 'label': '10.00x'},
)


def money(value) -> Decimal:
    return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def pick_segment() -> Segment:
    return random.choices(SEGMENTS, weights=[s.weight for s in SEGMENTS], k=1)[0]


def resolve_play(bet_amount: Decimal) -> dict:
    seg = pick_segment()
    jitter = (random.random() - 0.5) * (seg.span * 0.35)
    mult = money(seg.multiplier)
    return {
        'segment_id': seg.id,
        'multiplier': mult,
        'payout': money(bet_amount * mult),
        'target_angle': seg.angle + jitter,
        'color': seg.color,
    }


def public_config() -> dict:
    return {
        'currency': 'INR',
        'currency_symbol': '₹',
        'outcomes': list(OUTCOMES),
        'segments': [asdict(s) for s in SEGMENTS],
    }
