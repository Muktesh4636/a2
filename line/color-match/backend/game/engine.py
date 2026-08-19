"""Color Match — 3 reels, pay on 2 or 3 matching colors."""

from __future__ import annotations
import random
from decimal import Decimal, ROUND_HALF_UP

COLORS = (
    {'id': 'green', 'color': '#22c55e', 'multiplier': 1.5, 'weight': 14},
    {'id': 'yellow', 'color': '#eab308', 'multiplier': 2.0, 'weight': 10},
    {'id': 'purple', 'color': '#a855f7', 'multiplier': 3.0, 'weight': 4},
    {'id': 'blue', 'color': '#3b82f6', 'multiplier': 2.5, 'weight': 5},
    {'id': 'cyan', 'color': '#22d3ee', 'multiplier': 5.0, 'weight': 2},
    {'id': 'white', 'color': '#f8fafc', 'multiplier': 1.8, 'weight': 6},
    {'id': 'orange', 'color': '#f97316', 'multiplier': 10.0, 'weight': 1},
)
TWO_MATCH = Decimal('1.50')
BY_ID = {c['id']: c for c in COLORS}


def money(v) -> Decimal:
    return Decimal(v).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def pick_color() -> dict:
    return random.choices(COLORS, weights=[c['weight'] for c in COLORS], k=1)[0]


def resolve_play(bet: Decimal) -> dict:
    picks = [pick_color() for _ in range(3)]
    ids = [p['id'] for p in picks]
    colors = [p['color'] for p in picks]
    unique = set(ids)
    if len(unique) == 1:
        match, mult = 'three', money(picks[0]['multiplier'])
    elif len(unique) == 2:
        match, mult = 'two', TWO_MATCH
    else:
        match, mult = 'none', money(0)
    return {
        'reels': ids,
        'colors': colors,
        'match': match,
        'multiplier': mult,
        'payout': money(bet * mult),
    }
