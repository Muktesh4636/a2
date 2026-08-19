"""Triple Edge — three cards, bet Under / Edge / Over."""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass

from django.conf import settings

RANKS = [
    {"label": "A", "value": 1},
    {"label": "2", "value": 2},
    {"label": "3", "value": 3},
    {"label": "4", "value": 4},
    {"label": "5", "value": 5},
    {"label": "6", "value": 6},
]

SUITS = [
    {"symbol": "♠", "red": False},
    {"symbol": "♥", "red": True},
    {"symbol": "♦", "red": True},
    {"symbol": "♣", "red": False},
]


@dataclass(frozen=True)
class Card:
    label: str
    value: int
    symbol: str
    red: bool

    def to_dict(self) -> dict:
        return asdict(self)


def pick_card() -> Card:
    rank = random.choice(RANKS)
    suit = random.choice(SUITS)
    return Card(
        label=rank["label"],
        value=rank["value"],
        symbol=suit["symbol"],
        red=suit["red"],
    )


def result_side(sum_value: int) -> str:
    # Three cards sum 3–18. Edge band = 10–11.
    if sum_value <= 9:
        return "under"
    if sum_value <= 11:
        return "edge"
    return "over"


def deal_round(bet_side: str, chip: int, bankroll: int) -> dict:
    bet_side = (bet_side or "").lower().strip()
    if bet_side not in settings.PAYOUTS:
        raise ValueError("Invalid bet side. Use under, edge, or over.")

    if chip not in settings.ALLOWED_CHIPS:
        raise ValueError(f"Invalid chip. Allowed: {list(settings.ALLOWED_CHIPS)}")

    if bankroll < chip:
        raise ValueError("Not enough bankroll.")

    card1 = pick_card()
    card2 = pick_card()
    card3 = pick_card()
    total = card1.value + card2.value + card3.value
    won_side = result_side(total)
    won = won_side == bet_side

    bankroll_after = bankroll - chip
    payout = 0
    if won:
        payout = chip * settings.PAYOUTS[bet_side]
        bankroll_after += payout

    return {
        "card1": card1.to_dict(),
        "card2": card2.to_dict(),
        "card3": card3.to_dict(),
        "sum": total,
        "result_side": won_side,
        "bet_side": bet_side,
        "chip": chip,
        "won": won,
        "payout": payout,
        "bankroll": bankroll_after,
        "payouts": dict(settings.PAYOUTS),
    }
