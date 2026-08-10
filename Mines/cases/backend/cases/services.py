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
POOL: list[dict[str, Any]] = settings.CASES_POOL
REEL_LENGTH = settings.CASES_REEL_LENGTH
WIN_INDEX_MIN = settings.CASES_WIN_INDEX_MIN
WIN_INDEX_MAX = settings.CASES_WIN_INDEX_MAX


def money(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(TWO, rounding=ROUND_HALF_UP)


def get_or_create_player(player_id: str | None) -> Player:
    if player_id:
        try:
            return Player.objects.get(id=player_id)
        except (Player.DoesNotExist, ValueError):
            pass
    return Player.objects.create(balance=money(settings.CASES_STARTING_BALANCE))


def serialize_pool() -> list[dict[str, Any]]:
    return [
        {'multiplier': item['multiplier'], 'tone': item.get('tone', 'cyan')}
        for item in POOL
    ]


def pick_weighted() -> dict[str, Any]:
    weights = [int(item['weight']) for item in POOL]
    return random.choices(POOL, weights=weights, k=1)[0]


def build_reel(winner: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    win_index = random.randint(WIN_INDEX_MIN, min(WIN_INDEX_MAX, REEL_LENGTH - 1))
    reel: list[dict[str, Any]] = []
    for i in range(REEL_LENGTH):
        if i == win_index:
            reel.append(
                {
                    'multiplier': winner['multiplier'],
                    'tone': winner.get('tone', 'cyan'),
                }
            )
        else:
            filler = pick_weighted()
            reel.append(
                {
                    'multiplier': filler['multiplier'],
                    'tone': filler.get('tone', 'cyan'),
                }
            )
    return reel, win_index


def serialize_game(game: Game | None, player: Player) -> dict[str, Any]:
    payload: dict[str, Any] = {
        'pool': serialize_pool(),
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
        'multiplier': str(game.multiplier),
        'payout': str(game.payout),
        'profit': str(game.profit),
        'win_index': game.win_index,
        'reel': game.reel,
    }
    return payload


@transaction.atomic
def play_round(player: Player, bet_amount: Decimal) -> Game:
    min_bet = money(settings.CASES_MIN_BET)
    max_bet = money(settings.CASES_MAX_BET)
    bet = money(bet_amount)

    if bet < min_bet or bet > max_bet:
        raise ValidationError(
            {'bet_amount': f'Must be between ₹{min_bet} and ₹{max_bet}.'}
        )

    player = Player.objects.select_for_update().get(pk=player.pk)
    if player.balance < bet:
        raise ValidationError({'bet_amount': 'Insufficient balance.'})

    winner = pick_weighted()
    reel, win_index = build_reel(winner)
    multiplier = Decimal(str(winner['multiplier'])).quantize(FOUR)

    player.balance = money(player.balance - bet)
    payout = money(bet * multiplier)
    profit = money(payout - bet)
    player.balance = money(player.balance + payout)
    player.save(update_fields=['balance', 'updated_at'])

    status = Game.Status.WON if profit >= 0 else Game.Status.LOST

    return Game.objects.create(
        player=player,
        bet_amount=bet,
        status=status,
        multiplier=multiplier,
        payout=payout,
        profit=profit,
        win_index=win_index,
        reel=reel,
        finished_at=timezone.now(),
    )
