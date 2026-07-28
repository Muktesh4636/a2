"""
Authoritative Chicken Road game engine.
Ports road generation and settlement from src/App.jsx.
"""

from __future__ import annotations

import random
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.conf import settings
from django.db import transaction

TOTAL = 24

MULTS: dict[str, list[float]] = {
    'easy': [
        1.03, 1.07, 1.12, 1.17, 1.23, 1.29, 1.36, 1.44, 1.52, 1.61, 1.71, 1.81,
        1.92, 2.04, 2.17, 2.30, 2.45, 2.60, 2.76, 2.94, 3.12, 3.32, 3.53, 3.75,
    ],
    'medium': [
        1.12, 1.28, 1.47, 1.70, 1.98, 2.31, 2.70, 3.16, 3.70, 4.34, 5.10, 6.00,
        7.07, 8.34, 9.85, 11.64, 13.77, 16.30, 19.30, 22.85, 27.07, 32.08, 38.02, 45.08,
    ],
    'hard': [
        1.23, 1.55, 1.98, 2.56, 3.36, 4.45, 5.95, 8.03, 10.92, 14.97, 20.66, 28.70,
        40.12, 56.40, 79.80, 113.4, 161.8, 231.6, 332.8, 480.0, 694.5, 1008, 1468, 2144,
    ],
    'hardcore': [
        1.63, 2.80, 5.00, 9.31, 18.0, 36.1, 74.5, 157, 339, 748, 1690, 3910,
        9280, 22600, 56500, 145000, 382000, 1035000, 2880000, 8230000,
        24100000, 72500000, 224000000, 710000000,
    ],
}

FIRE_P = {'easy': 0.12, 'medium': 0.2, 'hard': 0.35, 'hardcore': 0.5}

DIFFICULTIES = tuple(MULTS.keys())

MIN_BET = int(getattr(settings, 'GAME_MIN_BET', 10))
MAX_BET = int(getattr(settings, 'GAME_MAX_BET', 500))


def money(value: float | Decimal | str | int) -> Decimal:
    return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def build_road(difficulty: str) -> list[dict[str, Any]]:
    if difficulty not in MULTS:
        raise ValueError(f'Invalid difficulty: {difficulty}')
    m = MULTS[difficulty]
    p = FIRE_P[difficulty]
    road = []
    for i in range(TOTAL):
        fire_chance = min(0.85, p * (1 + i * 0.08))
        road.append({
            'safe': random.random() >= fire_chance,
            'mult': m[i] if i < len(m) else m[-1],
            'revealed': False,
        })
    return road


def revealed_tiles(road: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for i, tile in enumerate(road):
        if tile.get('revealed'):
            out.append({
                'index': i,
                'safe': bool(tile['safe']),
                'mult': float(tile['mult']),
            })
    return out


def current_mult(road: list[dict[str, Any]], step: int) -> Decimal:
    if step <= 0:
        return Decimal('1.00')
    return money(road[step - 1]['mult'])


def public_state(round_obj, balance: Decimal | None = None) -> dict[str, Any]:
    road = list(round_obj.road_secret or [])
    step = int(round_obj.step)
    bet = money(round_obj.bet)
    mult = current_mult(road, step)
    cashout_amount = money(bet * mult) if step > 0 else money(0)
    burned = round_obj.status == round_obj.Status.BURNED

    payload = {
        'round_id': str(round_obj.id),
        'status': round_obj.status,
        'step': step,
        'bet': float(bet),
        'difficulty': round_obj.difficulty,
        'current_mult': float(mult),
        'cashout_amount': float(cashout_amount),
        'payout': float(money(round_obj.payout)),
        'revealed': revealed_tiles(road),
        'burned': burned,
    }
    if balance is not None:
        payload['balance'] = float(money(balance))
    return payload


def _credit(player, amount: Decimal) -> None:
    player.balance = money(player.balance + amount)
    player.save(update_fields=['balance', 'updated_at'])


@transaction.atomic
def start_round(player, bet: Decimal, difficulty: str):
    """Debit bet, create round, auto-advance onto first oven (index 0)."""
    from game.models import GameRound, Player

    if difficulty not in DIFFICULTIES:
        raise ValueError('Invalid difficulty')

    bet = money(bet)
    if bet < MIN_BET or bet > MAX_BET:
        raise ValueError(f'Bet must be between {MIN_BET} and {MAX_BET}')

    locked = Player.objects.select_for_update().get(pk=player.pk)
    if bet > locked.balance:
        raise ValueError('Insufficient balance')

    # End any stuck playing rounds for this player
    GameRound.objects.filter(player=locked, status=GameRound.Status.PLAYING).update(
        status=GameRound.Status.BURNED,
    )

    locked.balance = money(locked.balance - bet)
    locked.save(update_fields=['balance', 'updated_at'])

    road = build_road(difficulty)
    round_obj = GameRound.objects.create(
        player=locked,
        difficulty=difficulty,
        bet=bet,
        status=GameRound.Status.PLAYING,
        step=0,
        road_secret=road,
        payout=money(0),
    )

    # Auto first step (same as frontend startGame → advanceTo(0))
    return apply_go(round_obj, player_id=locked.id)


@transaction.atomic
def apply_go(round_obj, player_id=None):
    """Reveal the next oven. Returns public state dict."""
    from game.models import GameRound, Player

    locked_round = GameRound.objects.select_for_update().select_related('player').get(
        pk=round_obj.pk,
    )
    if locked_round.status != GameRound.Status.PLAYING:
        raise ValueError('Round is not active')

    road = list(locked_round.road_secret)
    index = int(locked_round.step)
    if index >= TOTAL or index >= len(road):
        raise ValueError('No more steps')

    tile = road[index]
    tile['revealed'] = True
    road[index] = tile
    next_step = index + 1
    locked_round.step = next_step
    locked_round.road_secret = road

    player = Player.objects.select_for_update().get(pk=locked_round.player_id)

    if not tile['safe']:
        locked_round.status = GameRound.Status.BURNED
        locked_round.payout = money(0)
        locked_round.save(update_fields=['step', 'road_secret', 'status', 'payout', 'updated_at'])
        return public_state(locked_round, balance=player.balance)

    if next_step >= TOTAL:
        # Cleared the whole road
        payout = money(locked_round.bet * money(tile['mult']))
        locked_round.status = GameRound.Status.WON
        locked_round.payout = payout
        locked_round.save(update_fields=['step', 'road_secret', 'status', 'payout', 'updated_at'])
        _credit(player, payout)
        player.refresh_from_db()
        state = public_state(locked_round, balance=player.balance)
        state['result'] = {
            'won': True,
            'total': float(payout),
            'net': float(money(payout - locked_round.bet)),
            'mult': float(money(tile['mult'])),
        }
        return state

    locked_round.save(update_fields=['step', 'road_secret', 'updated_at'])
    return public_state(locked_round, balance=player.balance)


@transaction.atomic
def apply_cashout(round_obj):
    from game.models import GameRound, Player

    locked_round = GameRound.objects.select_for_update().select_related('player').get(
        pk=round_obj.pk,
    )
    if locked_round.status != GameRound.Status.PLAYING:
        raise ValueError('Round is not active')
    if locked_round.step <= 0:
        raise ValueError('Cannot cash out before first step')

    road = list(locked_round.road_secret)
    mult = current_mult(road, locked_round.step)
    payout = money(locked_round.bet * mult)

    player = Player.objects.select_for_update().get(pk=locked_round.player_id)
    locked_round.status = GameRound.Status.CASHED_OUT
    locked_round.payout = payout
    locked_round.save(update_fields=['status', 'payout', 'updated_at'])
    _credit(player, payout)
    player.refresh_from_db()

    state = public_state(locked_round, balance=player.balance)
    state['result'] = {
        'won': True,
        'total': float(payout),
        'net': float(money(payout - locked_round.bet)),
        'mult': float(mult),
    }
    return state


def game_config() -> dict[str, Any]:
    return {
        'min_bet': MIN_BET,
        'max_bet': MAX_BET,
        'total_steps': TOTAL,
        'difficulties': list(DIFFICULTIES),
        'multipliers': {k: list(v) for k, v in MULTS.items()},
        'starting_balance': float(money(getattr(settings, 'GAME_STARTING_BALANCE', '1000.00'))),
    }
