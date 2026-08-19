"""Wave Surf — crash multiplier round with cashout."""
from __future__ import annotations
import math
import random
from decimal import Decimal, ROUND_HALF_UP

def money(v) -> Decimal:
    return Decimal(v).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

def generate_crash() -> float:
    # House-edged crash: often early, rare high
    # crash = max(1.01, 0.99 / (1 - r)) clipped
    r = random.random()
    if r < 0.03:
        return round(random.uniform(10, 40), 2)
    crash = 0.99 / max(1e-9, (1 - r))
    crash = max(1.01, min(crash, 50.0))
    return round(crash, 2)
