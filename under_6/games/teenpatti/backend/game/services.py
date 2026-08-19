"""Teen Patti vs Dealer — ante, then Play or Fold."""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass

from django.conf import settings

RANK_ORDER = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
RANK_VALUE = {
    "A": 14,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    "J": 11,
    "Q": 12,
    "K": 13,
}

SUITS = [
    {"symbol": "♠", "red": False},
    {"symbol": "♥", "red": True},
    {"symbol": "♦", "red": True},
    {"symbol": "♣", "red": False},
]

# Comparable category ints (higher wins)
CAT_TRAIL = 6
CAT_PURE = 5
CAT_SEQ = 4
CAT_COLOUR = 3
CAT_PAIR = 2
CAT_HIGH = 1

HAND_NAMES = {
    CAT_TRAIL: "trail",
    CAT_PURE: "pure_sequence",
    CAT_SEQ: "sequence",
    CAT_COLOUR: "colour",
    CAT_PAIR: "pair",
    CAT_HIGH: "high",
}

HAND_LABELS = {
    "trail": "Trail",
    "pure_sequence": "Pure sequence",
    "sequence": "Sequence",
    "colour": "Colour",
    "pair": "Pair",
    "high": "High card",
}


@dataclass(frozen=True)
class Card:
    label: str
    value: int
    symbol: str
    red: bool

    def to_dict(self) -> dict:
        return asdict(self)


def build_deck() -> list[Card]:
    deck: list[Card] = []
    for label in RANK_ORDER:
        for suit in SUITS:
            deck.append(
                Card(
                    label=label,
                    value=RANK_VALUE[label],
                    symbol=suit["symbol"],
                    red=suit["red"],
                )
            )
    return deck


def deal_cards(n: int = 6) -> list[Card]:
    deck = build_deck()
    random.shuffle(deck)
    return deck[:n]


def _sequence_high(values: list[int]) -> int | None:
    vals = sorted(values)
    if vals[2] - vals[1] == 1 and vals[1] - vals[0] == 1:
        return vals[2]
    if set(values) == {14, 2, 3}:
        return 3  # A-2-3 wheel — lowest sequence
    return None


def evaluate_hand(cards: list[Card]) -> tuple[tuple, str]:
    """Return (comparable_key, hand_name). Higher key wins."""
    values = [c.value for c in cards]
    suits = [c.symbol for c in cards]
    same_suit = len(set(suits)) == 1
    counts: dict[int, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1

    # Trail
    if len(counts) == 1:
        rank = values[0]
        return (CAT_TRAIL, rank, 0, 0), "trail"

    seq_high = _sequence_high(values)
    if seq_high is not None and same_suit:
        return (CAT_PURE, seq_high, 0, 0), "pure_sequence"
    if seq_high is not None:
        return (CAT_SEQ, seq_high, 0, 0), "sequence"
    if same_suit:
        ordered = tuple(sorted(values, reverse=True))
        return (CAT_COLOUR, *ordered), "colour"

    # Pair
    pair_rank = next((v for v, n in counts.items() if n == 2), None)
    if pair_rank is not None:
        kicker = next(v for v in values if v != pair_rank)
        return (CAT_PAIR, pair_rank, kicker, 0), "pair"

    ordered = tuple(sorted(values, reverse=True))
    return (CAT_HIGH, *ordered), "high"


def dealer_qualifies(key: tuple) -> bool:
    """Queen high or better (pair+ always qualifies)."""
    return key >= (CAT_HIGH, 12, 0, 0)


def compare_hands(player_key: tuple, dealer_key: tuple) -> str:
    if player_key > dealer_key:
        return "player"
    if dealer_key > player_key:
        return "dealer"
    return "tie"


def start_round(chip: int, bankroll: int) -> dict:
    if chip not in settings.ALLOWED_CHIPS:
        raise ValueError(f"Invalid chip. Allowed: {list(settings.ALLOWED_CHIPS)}")
    if bankroll < chip:
        raise ValueError("Not enough bankroll for ante.")

    dealt = deal_cards(6)
    player = dealt[0:3]
    dealer = dealt[3:6]
    player_key, player_hand = evaluate_hand(player)
    dealer_key, dealer_hand = evaluate_hand(dealer)

    bankroll_after = bankroll - chip

    return {
        "phase": "decide",
        "ante": chip,
        "play_chip": 0,
        "action": "",
        "player_cards": [c.to_dict() for c in player],
        "dealer_cards": [c.to_dict() for c in dealer],
        "player_hand": player_hand,
        "player_hand_label": HAND_LABELS[player_hand],
        "dealer_hand": dealer_hand,
        "dealer_hand_label": HAND_LABELS[dealer_hand],
        "player_key": list(player_key),
        "dealer_key": list(dealer_key),
        "dealer_qualified": False,
        "outcome": "",
        "won": False,
        "payout": 0,
        "bankroll": bankroll_after,
        "play_payouts": dict(settings.PLAY_PAYOUTS),
        "ante_payout": settings.ANTE_PAYOUT,
    }


def resolve_round(
    *,
    action: str,
    ante: int,
    bankroll: int,
    player_cards: list[dict],
    dealer_cards: list[dict],
) -> dict:
    action = (action or "").lower().strip()
    if action not in ("play", "fold"):
        raise ValueError("action must be play or fold.")

    player = [Card(**c) for c in player_cards]
    dealer = [Card(**c) for c in dealer_cards]
    player_key, player_hand = evaluate_hand(player)
    dealer_key, dealer_hand = evaluate_hand(dealer)

    if action == "fold":
        return {
            "phase": "resolved",
            "ante": ante,
            "play_chip": 0,
            "action": "fold",
            "player_cards": [c.to_dict() for c in player],
            "dealer_cards": [c.to_dict() for c in dealer],
            "player_hand": player_hand,
            "player_hand_label": HAND_LABELS[player_hand],
            "dealer_hand": dealer_hand,
            "dealer_hand_label": HAND_LABELS[dealer_hand],
            "dealer_qualified": dealer_qualifies(dealer_key),
            "outcome": "fold",
            "won": False,
            "payout": 0,
            "bankroll": bankroll,
            "play_payouts": dict(settings.PLAY_PAYOUTS),
            "ante_payout": settings.ANTE_PAYOUT,
        }

    if bankroll < ante:
        raise ValueError("Not enough bankroll for Play bet.")

    bankroll_after = bankroll - ante
    play_chip = ante
    qualified = dealer_qualifies(dealer_key)
    winner = compare_hands(player_key, dealer_key)
    payout = 0
    outcome = ""
    won = False

    if not qualified:
        # Ante pays; Play pushes (stake returned)
        payout = ante * settings.ANTE_PAYOUT + play_chip
        bankroll_after += payout
        outcome = "dealer_nq"
        won = True
    elif winner == "tie":
        payout = ante + play_chip
        bankroll_after += payout
        outcome = "tie"
        won = False
    elif winner == "player":
        play_mult = settings.PLAY_PAYOUTS[player_hand]
        payout = ante * settings.ANTE_PAYOUT + play_chip * play_mult
        bankroll_after += payout
        outcome = "player_win"
        won = True
    else:
        payout = 0
        outcome = "dealer_win"
        won = False

    return {
        "phase": "resolved",
        "ante": ante,
        "play_chip": play_chip,
        "action": "play",
        "player_cards": [c.to_dict() for c in player],
        "dealer_cards": [c.to_dict() for c in dealer],
        "player_hand": player_hand,
        "player_hand_label": HAND_LABELS[player_hand],
        "dealer_hand": dealer_hand,
        "dealer_hand_label": HAND_LABELS[dealer_hand],
        "dealer_qualified": qualified,
        "outcome": outcome,
        "won": won,
        "payout": payout,
        "bankroll": bankroll_after,
        "play_payouts": dict(settings.PLAY_PAYOUTS),
        "ante_payout": settings.ANTE_PAYOUT,
    }
