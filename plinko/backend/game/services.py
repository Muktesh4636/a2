import secrets
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from .models import Bet, Player
from .multipliers import get_multipliers


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def get_or_create_player(token: str | None) -> tuple[Player, str]:
    """Return player for token, or create a new guest player."""
    if token:
        player = Player.objects.filter(token=token).first()
        if player:
            return player, token

    new_token = secrets.token_hex(16)
    player = Player.objects.create(token=new_token, balance=_money(1000))
    return player, new_token


def place_bet(
    player: Player,
    *,
    amount,
    risk: str,
    rows: int,
    bucket_index: int | None = None,
) -> Bet:
    """
    Deduct bet, resolve landing bucket, credit payout, store history.

    If bucket_index is omitted, the server picks a fair random slot
    (binomial / Galton-style: each peg row is a fair left/right).
    """
    amount = _money(amount)
    if amount <= 0:
        raise ValueError("Bet amount must be greater than zero.")

    multipliers = get_multipliers(risk, rows)
    slots = len(multipliers)

    if bucket_index is None:
        # rows fair coin-flips → bucket in [0, rows]
        rights = sum(1 for _ in range(rows) if secrets.randbits(1))
        bucket_index = min(rights, slots - 1)
    else:
        if bucket_index < 0 or bucket_index >= slots:
            raise ValueError(f"bucket_index must be between 0 and {slots - 1}.")

    with transaction.atomic():
        player = Player.objects.select_for_update().get(pk=player.pk)

        if player.balance < amount:
            raise ValueError("Not enough balance.")

        multiplier = _money(multipliers[bucket_index])
        payout = _money(amount * multiplier)
        profit = _money(payout - amount)

        player.balance = _money(player.balance - amount + payout)
        player.save(update_fields=["balance", "updated_at"])

        bet = Bet.objects.create(
            player=player,
            amount=amount,
            risk=risk,
            rows=rows,
            bucket_index=bucket_index,
            multiplier=multiplier,
            payout=payout,
            profit=profit,
            balance_after=player.balance,
        )

    return bet


def reset_balance(player: Player, balance=1000) -> Player:
    player.balance = _money(balance)
    player.save(update_fields=["balance", "updated_at"])
    return player
