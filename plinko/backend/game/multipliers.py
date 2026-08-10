"""Plinko multiplier tables (mirrors the frontend)."""

MULTIPLIERS = {
    "low": {
        8: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
        10: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9],
        12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
        14: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1],
        16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    },
    "medium": {
        8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
        10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
        12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
        14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
        16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    },
    "high": {
        8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
        10: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
        12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
        14: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
        16: [
            10000,
            216,
            26,
            7,
            2.5,
            1.1,
            0.1,
            0.1,
            0.1,
            0.1,
            0.1,
            1.1,
            2.5,
            7,
            26,
            216,
            10000,
        ],
    },
}

VALID_RISKS = set(MULTIPLIERS.keys())
VALID_ROWS = {8, 10, 12, 14, 16}


def get_multipliers(risk: str, rows: int) -> list[float]:
    if risk not in VALID_RISKS:
        raise ValueError(f"Invalid risk: {risk}")
    if rows not in VALID_ROWS:
        raise ValueError(f"Invalid rows: {rows}")
    return list(MULTIPLIERS[risk][rows])


def format_multiplier(value: float) -> str:
    if value >= 1000:
        k = value / 1000
        return f"{int(k)}K" if k == int(k) else f"{k:.1f}K"
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.1f}"
