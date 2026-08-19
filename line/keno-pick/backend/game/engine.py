"""Keno Pick — pick 1–10 of 40, draw 10, pay by hits."""
from __future__ import annotations
import random
from decimal import Decimal, ROUND_HALF_UP

POOL = 40
DRAW_COUNT = 10
MIN_PICKS = 1
MAX_PICKS = 10

# payouts[pick_count][hits] = multiplier
PAYOUTS: dict[int, list[float]] = {
    1:  [0, 3.5],
    2:  [0, 1.0, 9.0],
    3:  [0, 0, 2.0, 20.0],
    4:  [0, 0, 1.0, 5.0, 50.0],
    5:  [0, 0, 0.5, 2.0, 12.0, 100.0],
    6:  [0, 0, 0, 1.5, 4.0, 10.0, 20.0],
    7:  [0, 0, 0, 1.0, 3.0, 8.0, 25.0, 80.0],
    8:  [0, 0, 0, 0.5, 2.0, 5.0, 15.0, 50.0, 200.0],
    9:  [0, 0, 0, 0, 1.5, 4.0, 10.0, 30.0, 100.0, 500.0],
    10: [0, 0, 0, 0, 1.0, 2.5, 8.0, 25.0, 100.0, 1000.0, 10000.0],
}


def money(v) -> Decimal:
    return Decimal(v).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def payout_table(pick_count: int) -> list[dict]:
    row = PAYOUTS.get(pick_count, PAYOUTS[6])
    return [{'hits': i, 'multiplier': f'{m:.2f}'} for i, m in enumerate(row)]


def resolve_play(picks: list[int], bet: Decimal) -> dict:
    picks = sorted(set(int(x) for x in picks))
    if not (MIN_PICKS <= len(picks) <= MAX_PICKS):
        raise ValueError(f'Pick {MIN_PICKS}–{MAX_PICKS} numbers')
    if any(n < 1 or n > POOL for n in picks):
        raise ValueError(f'Numbers must be 1–{POOL}')
    drawn = sorted(random.sample(range(1, POOL + 1), DRAW_COUNT))
    hits = sorted(set(picks) & set(drawn))
    hit_count = len(hits)
    table = PAYOUTS[len(picks)]
    mult = money(table[hit_count] if hit_count < len(table) else 0)
    return {
        'picks': picks,
        'drawn': drawn,
        'hits': hits,
        'hit_count': hit_count,
        'multiplier': mult,
        'payout': money(bet * mult),
        'table': payout_table(len(picks)),
    }
