"""Hi-Lo Cards — guess higher/lower, streak multiplier, cash out."""
from __future__ import annotations
import random
from decimal import Decimal, ROUND_HALF_UP

RANKS = list(range(1, 14))  # A=1 … K=13
SUITS = ('S', 'H', 'D', 'C')
RANK_LABEL = {1: 'A', 11: 'J', 12: 'Q', 13: 'K'}
# Multiplier after n correct guesses
STREAK_MULT = [
    Decimal('1.98'),
    Decimal('3.20'),
    Decimal('5.50'),
    Decimal('9.00'),
    Decimal('15.00'),
    Decimal('25.00'),
    Decimal('45.00'),
    Decimal('80.00'),
    Decimal('140.00'),
    Decimal('250.00'),
]


def money(v) -> Decimal:
    return Decimal(v).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def label_rank(r: int) -> str:
    return RANK_LABEL.get(r, str(r))


def deal_card(exclude: set[tuple[int, str]] | None = None) -> dict:
    exclude = exclude or set()
    while True:
        rank = random.choice(RANKS)
        suit = random.choice(SUITS)
        if (rank, suit) not in exclude:
            return {
                'rank': rank,
                'suit': suit,
                'label': label_rank(rank),
                'red': suit in ('H', 'D'),
            }


def multiplier_for_streak(n: int) -> Decimal:
    if n <= 0:
        return Decimal('0')
    if n > len(STREAK_MULT):
        return STREAK_MULT[-1]
    return STREAK_MULT[n - 1]


def next_multiplier(streak: int) -> Decimal:
    return multiplier_for_streak(streak + 1)
