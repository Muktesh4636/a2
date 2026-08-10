from __future__ import annotations

import random
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Game, Player

TWO = Decimal('0.01')
FOUR = Decimal('0.0001')
TRACK = settings.SNAKE_TRACK
TRACK_LEN = len(TRACK)


def money(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(TWO, rounding=ROUND_HALF_UP)


def get_or_create_player(player_id: str | None) -> Player:
    if player_id:
        try:
            return Player.objects.get(id=player_id)
        except (Player.DoesNotExist, ValueError):
            pass
    return Player.objects.create(balance=money(settings.SNAKE_STARTING_BALANCE))


def serialize_track() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, tile in enumerate(TRACK):
        item: dict[str, Any] = {'index': i, 'type': tile['type']}
        if tile['type'] == 'mult':
            item['multiplier'] = tile['value']
        out.append(item)
    return out


def serialize_game(game: Game | None, player: Player) -> dict[str, Any]:
    payload: dict[str, Any] = {
        'track': serialize_track(),
        'balance': str(player.balance),
        'player_id': str(player.id),
        'active_game': None,
    }
    if game is None:
        return payload

    payload['active_game'] = {
        'id': str(game.id),
        'status': game.status,
        'bet_amount': str(game.bet_amount),
        'die1': game.die1,
        'die2': game.die2,
        'dice_sum': game.dice_sum,
        'land_index': game.land_index,
        'multiplier': str(game.multiplier),
        'payout': str(game.payout),
        'profit': str(game.profit),
    }
    return payload


@transaction.atomic
def play_round(player: Player, bet_amount: Decimal) -> Game:
    min_bet = money(settings.SNAKE_MIN_BET)
    max_bet = money(settings.SNAKE_MAX_BET)
    bet = money(bet_amount)

    if bet < min_bet or bet > max_bet:
        raise ValidationError(
            {'bet_amount': f'Must be between ₹{min_bet} and ₹{max_bet}.'}
        )

    player = Player.objects.select_for_update().get(pk=player.pk)
    if player.balance < bet:
        raise ValidationError({'bet_amount': 'Insufficient balance.'})

    die1 = random.randint(1, 6)
    die2 = random.randint(1, 6)
    dice_sum = die1 + die2
    # Play tile counts as box 1; roll of 6 → 6th box (0-based index 5)
    land_index = (dice_sum - 1) % TRACK_LEN
    tile = TRACK[land_index]

    player.balance = money(player.balance - bet)

    if tile['type'] == 'snake':
        status = Game.Status.LOST
        multiplier = Decimal('0')
        payout = money(0)
        profit = money(-bet)
    else:
        # 'mult' or rare 'start' land
        status = Game.Status.WON
        raw = tile.get('value', '1.00')
        multiplier = Decimal(str(raw)).quantize(FOUR)
        payout = money(bet * multiplier)
        profit = money(payout - bet)
        player.balance = money(player.balance + payout)

    player.save(update_fields=['balance', 'updated_at'])

    return Game.objects.create(
        player=player,
        bet_amount=bet,
        die1=die1,
        die2=die2,
        dice_sum=dice_sum,
        land_index=land_index,
        status=status,
        multiplier=multiplier,
        payout=payout,
        profit=profit,
        finished_at=timezone.now(),
    )
