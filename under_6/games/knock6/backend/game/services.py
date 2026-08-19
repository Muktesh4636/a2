"""Server-side Knock 6 rules — sixes knock you out."""

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


def resolve_outcome(card1: Card, card2: Card) -> str:
    """Return knocked | clear | pair."""
    if card1.value == 6 or card2.value == 6:
        return "knocked"
    if card1.value == card2.value:
        return "pair"
    return "clear"


def deal_round(bet_side: str, chip: int, bankroll: int) -> dict:
    bet_side = (bet_side or "").lower().strip()
    if bet_side not in settings.PAYOUTS:
        raise ValueError("Invalid bet side. Use clear or pair.")

    if chip not in settings.ALLOWED_CHIPS:
        raise ValueError(f"Invalid chip. Allowed: {list(settings.ALLOWED_CHIPS)}")

    if bankroll < chip:
        raise ValueError("Not enough bankroll.")

    card1 = pick_card()
    card2 = pick_card()
    outcome = resolve_outcome(card1, card2)
    total = card1.value + card2.value

    # clear wins on clear OR pair; pair only wins on pair
    if bet_side == "clear":
        won = outcome in ("clear", "pair")
    else:  # pair
        won = outcome == "pair"

    bankroll_after = bankroll - chip
    payout = 0
    if won:
        payout = chip * settings.PAYOUTS[bet_side]
        bankroll_after += payout

    return {
        "card1": card1.to_dict(),
        "card2": card2.to_dict(),
        "sum": total,
        "result_side": outcome,
        "bet_side": bet_side,
        "chip": chip,
        "won": won,
        "payout": payout,
        "bankroll": bankroll_after,
        "has_six": outcome == "knocked",
        "is_pair": outcome == "pair",
        "payouts": dict(settings.PAYOUTS),
    }
