"""Roulette bet hit / payout rules — mirrors app.js and BetRules.kt."""

from __future__ import annotations

from dataclasses import dataclass

RED_NUMBERS = frozenset(
    {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
)
COL1 = frozenset({1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34})
COL2 = frozenset({2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35})
COL3 = frozenset({3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36})

EVEN_MONEY_TYPES = frozenset({"red", "black", "even", "odd", "low", "high"})
VALID_CHIP_AMOUNTS = frozenset({10, 20, 50, 100, 500, 1000})


@dataclass(frozen=True)
class BetKey:
    bet_type: str
    bet_value: str = ""

    @property
    def key(self) -> str:
        if self.bet_value:
            return f"{self.bet_type}:{self.bet_value}"
        return self.bet_type


def parse_bet_key(raw: str) -> BetKey:
    """Parse keys like 'straight:17', 'dozen:2', 'red'."""
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("bet key is required")
    if ":" in raw:
        bet_type, bet_value = raw.split(":", 1)
        return BetKey(bet_type=bet_type.strip().lower(), bet_value=bet_value.strip())
    return BetKey(bet_type=raw.strip().lower(), bet_value="")


def validate_bet_key(key: BetKey) -> None:
    t = key.bet_type
    v = key.bet_value
    if t == "straight":
        if not v.isdigit() or not (0 <= int(v) <= 36):
            raise ValueError("straight value must be 0–36")
    elif t in ("dozen", "column"):
        if v not in {"1", "2", "3"}:
            raise ValueError(f"{t} value must be 1, 2, or 3")
    elif t in EVEN_MONEY_TYPES:
        if v:
            raise ValueError(f"{t} bets take no value")
    else:
        raise ValueError(f"unknown bet type: {t}")


def hits(key: BetKey, num: int) -> bool:
    t = key.bet_type
    v = key.bet_value
    if t == "straight":
        return int(v) == num
    if num == 0:
        return False
    if t == "red":
        return num in RED_NUMBERS
    if t == "black":
        return num not in RED_NUMBERS
    if t == "even":
        return num % 2 == 0
    if t == "odd":
        return num % 2 == 1
    if t == "low":
        return 1 <= num <= 18
    if t == "high":
        return 19 <= num <= 36
    if t == "dozen":
        dozen = int(v)
        if dozen == 1:
            return 1 <= num <= 12
        if dozen == 2:
            return 13 <= num <= 24
        return 25 <= num <= 36
    if t == "column":
        col = int(v)
        if col == 1:
            return num in COL1
        if col == 2:
            return num in COL2
        return num in COL3
    return False


def payout_odds(key: BetKey) -> int:
    """Gross return multiplier (includes stake)."""
    t = key.bet_type
    if t == "straight":
        return 36
    if t in ("dozen", "column"):
        return 3
    return 2


def settle_amount(key: BetKey, amount: int, num: int) -> int:
    if hits(key, num):
        return amount * payout_odds(key)
    return 0
