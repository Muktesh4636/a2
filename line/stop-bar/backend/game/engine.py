"""Server-authoritative stop-bar outcomes. Always lands on a colored zone."""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass
from decimal import Decimal, ROUND_HALF_UP


@dataclass(frozen=True)
class Zone:
    id: str
    multiplier: float
    color: str
    start: float
    end: float
    weight: int


# Equal tile size + equal gaps (incl. seam between loop repeats)
_TILE = 7.0
_STEP = 100.0 / 9.0


def _zone(id: str, mult: float, color: str, index: int, weight: int) -> Zone:
    start = index * _STEP
    return Zone(id, mult, color, start, start + _TILE, weight)


ZONES: tuple[Zone, ...] = (
    _zone('g1', 1.5, '#00e701', 0, 14),
    _zone('y1', 2.0, '#fde047', 1, 10),
    _zone('c1', 5.0, '#22d3ee', 2, 2),
    _zone('w1', 1.8, '#ffffff', 3, 6),
    _zone('y2', 2.0, '#fde047', 4, 10),
    _zone('o1', 10.0, '#fb923c', 5, 1),
    _zone('g2', 1.5, '#00e701', 6, 14),
    _zone('y3', 2.0, '#fde047', 7, 10),
    _zone('p1', 3.0, '#a855f7', 8, 4),
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


def pick_zone() -> Zone:
    weights = [z.weight for z in ZONES]
    return random.choices(ZONES, weights=weights, k=1)[0]


def landing_position(zone: Zone) -> float:
    """Percent along the bar; stay inside the colored zone."""
    span = zone.end - zone.start
    pad = span * 0.2
    return random.uniform(zone.start + pad, zone.end - pad)


def money(value: Decimal | float | str) -> Decimal:
    return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def resolve_play(bet_amount: Decimal) -> dict:
    zone = pick_zone()
    multiplier = money(zone.multiplier)
    payout = money(bet_amount * multiplier)
    return {
        'zone_id': zone.id,
        'multiplier': multiplier,
        'payout': payout,
        'target_position': landing_position(zone),
        'color': zone.color,
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
        'zones': [asdict(z) for z in ZONES],
    }
