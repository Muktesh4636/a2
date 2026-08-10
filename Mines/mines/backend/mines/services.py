from __future__ import annotations

import random
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Game, Player

GRID_SIZE = settings.MINES_GRID_SIZE
HOUSE_EDGE = Decimal(str(settings.MINES_HOUSE_EDGE))
TWO_PLACES = Decimal('0.01')
FOUR_PLACES = Decimal('0.0001')


def money(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def get_multiplier(mine_count: int, gems_found: int) -> Decimal:
    if gems_found <= 0:
        return Decimal('1.0000')

    gems = GRID_SIZE - mine_count
    chance = Decimal('1')

    for i in range(gems_found):
        chance *= Decimal(gems - i) / Decimal(GRID_SIZE - i)

    if chance <= 0:
        return Decimal('1.0000')

    mult = (Decimal('1') - HOUSE_EDGE) / chance
    return mult.quantize(FOUR_PLACES, rounding=ROUND_HALF_UP)


def create_mine_positions(mine_count: int) -> list[int]:
    return sorted(random.sample(range(GRID_SIZE), mine_count))


def get_or_create_player(player_id: str | None) -> Player:
    if player_id:
        try:
            return Player.objects.get(id=player_id)
        except (Player.DoesNotExist, ValueError):
            pass

    return Player.objects.create(
        balance=money(settings.MINES_STARTING_BALANCE),
    )


def serialize_board(game: Game) -> list[dict[str, str]]:
    mines = set(game.mine_positions)
    revealed = set(game.revealed)
    game_over = game.status != Game.Status.PLAYING
    board: list[dict[str, str]] = []

    for i in range(GRID_SIZE):
        is_mine = i in mines
        is_revealed = i in revealed

        if is_revealed or game_over:
            board.append(
                {
                    'content': 'mine' if is_mine else 'gem',
                    'state': 'revealed' if is_revealed else 'hidden',
                }
            )
        else:
            board.append({'content': 'hidden', 'state': 'hidden'})

    return board


def serialize_game(game: Game, player: Player | None = None) -> dict[str, Any]:
    player = player or game.player
    return {
        'id': str(game.id),
        'status': game.status,
        'bet_amount': str(game.bet_amount),
        'mine_count': game.mine_count,
        'gems_found': game.gems_found,
        'multiplier': str(game.multiplier),
        'profit': str(game.profit),
        'payout': str(game.payout),
        'triggered_mine': game.triggered_mine,
        'board': serialize_board(game),
        'balance': str(player.balance),
        'player_id': str(player.id),
    }


@transaction.atomic
def start_game(player: Player, bet_amount: Decimal, mine_count: int) -> Game:
    min_bet = money(settings.MINES_MIN_BET)
    max_bet = money(settings.MINES_MAX_BET)
    bet = money(bet_amount)

    if mine_count < 1 or mine_count > GRID_SIZE - 1:
        raise ValidationError({'mine_count': f'Must be between 1 and {GRID_SIZE - 1}.'})

    if bet < min_bet or bet > max_bet:
        raise ValidationError(
            {'bet_amount': f'Must be between ₹{min_bet} and ₹{max_bet}.'}
        )

    player = Player.objects.select_for_update().get(pk=player.pk)

    if Game.objects.filter(player=player, status=Game.Status.PLAYING).exists():
        raise ValidationError({'detail': 'Finish your current game first.'})

    if player.balance < bet:
        raise ValidationError({'bet_amount': 'Insufficient balance.'})

    player.balance = money(player.balance - bet)
    player.save(update_fields=['balance', 'updated_at'])

    game = Game.objects.create(
        player=player,
        bet_amount=bet,
        mine_count=mine_count,
        mine_positions=create_mine_positions(mine_count),
        revealed=[],
        status=Game.Status.PLAYING,
        gems_found=0,
        multiplier=Decimal('1.0000'),
        payout=money(0),
        profit=money(0),
    )
    return game


@transaction.atomic
def reveal_tile(game: Game, index: int) -> Game:
    game = Game.objects.select_for_update().select_related('player').get(pk=game.pk)

    if game.status != Game.Status.PLAYING:
        raise ValidationError({'detail': 'Game is not active.'})

    if index < 0 or index >= GRID_SIZE:
        raise ValidationError({'index': f'Must be between 0 and {GRID_SIZE - 1}.'})

    if index in game.revealed:
        raise ValidationError({'index': 'Tile already revealed.'})

    revealed = list(game.revealed)
    revealed.append(index)
    game.revealed = revealed

    if index in game.mine_positions:
        game.status = Game.Status.LOST
        game.triggered_mine = index
        game.multiplier = Decimal('0.0000')
        game.payout = money(0)
        game.profit = money(-game.bet_amount)
        game.finished_at = timezone.now()
        game.save()
        return game

    gems_found = game.gems_found + 1
    total_gems = GRID_SIZE - game.mine_count
    multiplier = get_multiplier(game.mine_count, gems_found)
    profit = money(game.bet_amount * multiplier - game.bet_amount)

    game.gems_found = gems_found
    game.multiplier = multiplier
    game.profit = profit
    game.payout = money(game.bet_amount * multiplier)

    if gems_found >= total_gems:
        player = Player.objects.select_for_update().get(pk=game.player_id)
        player.balance = money(player.balance + game.payout)
        player.save(update_fields=['balance', 'updated_at'])
        game.status = Game.Status.WON
        game.finished_at = timezone.now()

    game.save()
    return game


@transaction.atomic
def cash_out(game: Game) -> Game:
    game = Game.objects.select_for_update().select_related('player').get(pk=game.pk)

    if game.status != Game.Status.PLAYING:
        raise ValidationError({'detail': 'Game is not active.'})

    if game.gems_found <= 0:
        raise ValidationError({'detail': 'Reveal at least one gem before cashing out.'})

    payout = money(game.bet_amount * game.multiplier)
    profit = money(payout - game.bet_amount)

    player = Player.objects.select_for_update().get(pk=game.player_id)
    player.balance = money(player.balance + payout)
    player.save(update_fields=['balance', 'updated_at'])

    game.payout = payout
    game.profit = profit
    game.status = Game.Status.CASHED
    game.finished_at = timezone.now()
    game.save()
    return game
