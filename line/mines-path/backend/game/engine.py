"""Mines Path — server holds mine layout; reveal / cashout."""

from __future__ import annotations

import json
import random
from decimal import Decimal, ROUND_HALF_UP

TILE_COUNT = 8
MINE_COUNT = 2
SAFE_MULTIPLIERS = [Decimal('1.20'), Decimal('1.55'), Decimal('2.10'), Decimal('2.90'), Decimal('4.20'), Decimal('7.00')]


def money(value) -> Decimal:
    return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def make_mines() -> list[int]:
    return sorted(random.sample(range(TILE_COUNT), MINE_COUNT))


def multiplier_for_safes(n: int) -> Decimal:
    if n <= 0:
        return Decimal('0')
    if n > len(SAFE_MULTIPLIERS):
        return SAFE_MULTIPLIERS[-1]
    return SAFE_MULTIPLIERS[n - 1]


def next_multiplier(safe_count: int) -> Decimal:
    if safe_count >= len(SAFE_MULTIPLIERS):
        return SAFE_MULTIPLIERS[-1]
    return SAFE_MULTIPLIERS[safe_count]


def mines_from_json(raw: str) -> list[int]:
    return list(json.loads(raw))
