"""Server-authoritative wheel outcomes. Always lands on a colored tile."""

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
    Segment('g1', 1.5, '#00e701', 0, 10, 14),
    Segment('y1', 2.0, '#fde047', 38, 10, 10),
    Segment('y2', 2.0, '#fde047', 72, 10, 10),
    Segment('g2', 1.5, '#00e701', 118, 10, 14),
    Segment('p1', 3.0, '#a855f7', 180, 10, 4),
    Segment('w1', 1.8, '#ffffff', 230, 10, 6),
    Segment('y3', 2.0, '#fde047', 278, 10, 10),
    Segment('y4', 2.0, '#fde047', 318, 10, 10),
)

OUTCOMES = (
    {'id': 'lose', 'multiplier': 0, 'color': '#3a4553', 'label': '0.00x'},
    {'id': 'green', 'multiplier': 1.5, 'color': '#00e701', 'label': '1.50x'},
    {'id': 'white', 'multiplier': 1.8, 'color': '#ffffff', 'label': '1.80x'},
    {'id': 'yellow', 'multiplier': 2, 'color': '#fde047', 'label': '2.00x'},
    {'id': 'purple', 'multiplier': 3, 'color': '#a855f7', 'label': '3.00x'},
)


def pick_segment() -> Segment:
    weights = [s.weight for s in SEGMENTS]
    return random.choices(SEGMENTS, weights=weights, k=1)[0]


def landing_angle(segment: Segment) -> float:
    """Angle under the pointer; jitter stays inside the colored tile."""
    jitter = (random.random() - 0.5) * (segment.span * 0.35)
    return segment.angle + jitter


def money(value: Decimal | float | str) -> Decimal:
    return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def resolve_spin(bet_amount: Decimal) -> dict:
    segment = pick_segment()
    multiplier = money(segment.multiplier)
    payout = money(bet_amount * multiplier)
    angle = landing_angle(segment)
    return {
        'segment_id': segment.id,
        'multiplier': multiplier,
        'payout': payout,
        'target_angle': angle,
        'color': segment.color,
    }


def public_config() -> dict:
    return {
        'currency': 'INR',
        'currency_symbol': '₹',
        'initial_balance': '1000.00',
        'min_bet': '1.00',
        'max_bet': '500.00',
        'default_bet': '10.00',
        'outcomes': list(OUTCOMES),
        'segments': [asdict(s) for s in SEGMENTS],
    }
