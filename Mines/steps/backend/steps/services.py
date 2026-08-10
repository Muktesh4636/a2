from __future__ import annotations

import random
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Game, Player

ROWS = settings.STEPS_ROWS
COLS = settings.STEPS_COLS
HOUSE_EDGE = Decimal(str(settings.STEPS_HOUSE_EDGE))
TWO_PLACES = Decimal('0.01')
FOUR_PLACES = Decimal('0.0001')
SAFE_PER_ROW = COLS - 1  # 2 eggs, 1 danger


def money(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def get_multiplier(steps_cleared: int) -> Decimal:
    """Fair multiplier after surviving `steps_cleared` rows (each 2/3 safe)."""
    if steps_cleared <= 0:
        return Decimal('1.0000')

    chance = (Decimal(SAFE_PER_ROW) / Decimal(COLS)) ** steps_cleared
    if chance <= 0:
        return Decimal('1.0000')

    mult = (Decimal('1') - HOUSE_EDGE) / chance
    return mult.quantize(FOUR_PLACES, rounding=ROUND_HALF_UP)


def create_danger_map() -> list[int]:
    return [random.randrange(COLS) for _ in range(ROWS)]


def get_or_create_player(player_id: str | None) -> Player:
    if player_id:
        try:
            return Player.objects.get(id=player_id)
        except (Player.DoesNotExist, ValueError):
            pass

    return Player.objects.create(balance=money(settings.STEPS_STARTING_BALANCE))


def serialize_board(game: Game) -> list[list[dict[str, Any]]]:
    """
    Board as rows from top → bottom for UI (row 0 = top).
    Internal current_row is bottom-up (0 = bottom).
    """
    game_over = game.status != Game.Status.PLAYING
    path_by_row = {i: col for i, col in enumerate(game.path)}
    board: list[list[dict[str, Any]]] = []

    for ui_row in range(ROWS):
        # Convert UI top-index to bottom-up index
        row = ROWS - 1 - ui_row
        danger = game.danger_columns[row]
        cells: list[dict[str, Any]] = []

        for col in range(COLS):
            is_danger = col == danger
            chosen = path_by_row.get(row) == col
            is_current = (
                game.status == Game.Status.PLAYING and row == game.current_row
            )

            # During play: show chosen eggs on completed rows; hide everything else.
            # On game over: reveal full route (eggs + dangers).
            if game_over:
                content = 'danger' if is_danger else 'egg'
                state = 'revealed'
            elif chosen:
                content = 'egg'
                state = 'revealed'
            else:
                content = 'hidden'
                state = 'hidden'

            cells.append(
                {
                    'content': content,
                    'state': state,
                    'active': is_current,
                    'chosen': chosen,
                    'triggered': (
                        game.triggered_row == row and game.triggered_col == col
                    ),
                }
            )
        board.append(cells)

    return board


def serialize_game(game: Game, player: Player | None = None) -> dict[str, Any]:
    player = player or game.player
    return {
        'id': str(game.id),
        'status': game.status,
        'bet_amount': str(game.bet_amount),
        'current_row': game.current_row,
        'steps_cleared': game.steps_cleared,
        'rows': ROWS,
        'cols': COLS,
        'multiplier': str(game.multiplier),
        'profit': str(game.profit),
        'payout': str(game.payout),
        'triggered_row': game.triggered_row,
        'triggered_col': game.triggered_col,
        'board': serialize_board(game),
        'balance': str(player.balance),
        'player_id': str(player.id),
    }


@transaction.atomic
def start_game(player: Player, bet_amount: Decimal) -> Game:
    min_bet = money(settings.STEPS_MIN_BET)
    max_bet = money(settings.STEPS_MAX_BET)
    bet = money(bet_amount)

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

    return Game.objects.create(
        player=player,
        bet_amount=bet,
        danger_columns=create_danger_map(),
        path=[],
        current_row=0,
        steps_cleared=0,
        status=Game.Status.PLAYING,
        multiplier=Decimal('1.0000'),
        payout=money(0),
        profit=money(0),
    )


@transaction.atomic
def choose_step(game: Game, column: int) -> Game:
    game = Game.objects.select_for_update().select_related('player').get(pk=game.pk)

    if game.status != Game.Status.PLAYING:
        raise ValidationError({'detail': 'Game is not active.'})

    if column < 0 or column >= COLS:
        raise ValidationError({'column': f'Must be between 0 and {COLS - 1}.'})

    row = game.current_row
    danger = game.danger_columns[row]

    if column == danger:
        game.path = list(game.path)  # unchanged path of successful steps
        game.status = Game.Status.LOST
        game.triggered_row = row
        game.triggered_col = column
        game.multiplier = Decimal('0.0000')
        game.payout = money(0)
        game.profit = money(-game.bet_amount)
        game.finished_at = timezone.now()
        game.save()
        return game

    path = list(game.path)
    path.append(column)
    steps = game.steps_cleared + 1
    multiplier = get_multiplier(steps)
    profit = money(game.bet_amount * multiplier - game.bet_amount)
    payout = money(game.bet_amount * multiplier)

    game.path = path
    game.steps_cleared = steps
    game.multiplier = multiplier
    game.profit = profit
    game.payout = payout
    game.current_row = row + 1

    if steps >= ROWS:
        player = Player.objects.select_for_update().get(pk=game.player_id)
        player.balance = money(player.balance + payout)
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

    if game.steps_cleared <= 0:
        raise ValidationError({'detail': 'Clear at least one step before cashing out.'})

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
