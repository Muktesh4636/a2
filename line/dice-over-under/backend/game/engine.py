"""Dice Over/Under engine."""

from __future__ import annotations

import random
from decimal import Decimal, ROUND_HALF_UP

MIN_TARGET = 2
MAX_TARGET = 98


def money(value) -> Decimal:
    return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def calc_multiplier(target: int, side: str) -> Decimal:
    t = max(MIN_TARGET, min(MAX_TARGET, int(target)))
    chance = t if side == 'under' else 100 - t
    raw = Decimal(99) / Decimal(chance)
    return money(raw)


def roll() -> Decimal:
    # 0.00 .. 100.00 inclusive-ish
    return money(random.uniform(0, 100))


def resolve_play(bet: Decimal, target: int, side: str) -> dict:
    if side not in ('under', 'over'):
        raise ValueError('side must be under or over')
    t = max(MIN_TARGET, min(MAX_TARGET, int(target)))
    value = roll()
    won = (value < t) if side == 'under' else (value > t)
    mult = calc_multiplier(t, side) if won else Decimal('0')
    payout = money(bet * mult) if won else money(0)
    return {
        'roll': float(value),
        'won': won,
        'multiplier': mult if won else money(0),
        'payout': payout,
        'target': t,
        'side': side,
    }
