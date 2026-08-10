from __future__ import annotations

import random
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Game, Player

ROWS = settings.BOXES_ROWS
COLS = settings.BOXES_COLS
GRID = ROWS * COLS
PICK = settings.BOXES_PICK_COUNT
TWO = Decimal('0.01')
FOUR = Decimal('0.0001')


def money(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(TWO, rounding=ROUND_HALF_UP)


def get_or_create_player(player_id: str | None) -> Player:
    if player_id:
        try:
            return Player.objects.get(id=player_id)
        except (Player.DoesNotExist, ValueError):
            pass
    return Player.objects.create(balance=money(settings.BOXES_STARTING_BALANCE))


def weighted_multiplier() -> Decimal:
    values = [Decimal(str(v)) for v, _ in settings.BOXES_MULTIPLIER_WEIGHTS]
    weights = [w for _, w in settings.BOXES_MULTIPLIER_WEIGHTS]
    return random.choices(values, weights=weights, k=1)[0]


def generate_board() -> list[str]:
    return [str(weighted_multiplier()) for _ in range(GRID)]


def serialize_board(game: Game) -> list[dict[str, Any]]:
    selected = set(game.selected)
    settled = game.status == Game.Status.SETTLED
    threshold = Decimal(str(settings.BOXES_HIGHLIGHT_THRESHOLD))
    board: list[dict[str, Any]] = []

    for i in range(GRID):
        cell: dict[str, Any] = {
            'index': i,
            'selected': i in selected,
            'multiplier': None,
            'highlight': False,
        }
        if settled and game.multipliers:
            mult = Decimal(str(game.multipliers[i]))
            cell['multiplier'] = str(mult)
            cell['highlight'] = mult >= threshold
        board.append(cell)
    return board


def serialize_game(game: Game, player: Player | None = None) -> dict[str, Any]:
    player = player or game.player
    return {
        'id': str(game.id),
        'status': game.status,
        'bet_amount': str(game.bet_amount),
        'selected': game.selected,
        'pick_count': PICK,
        'rows': ROWS,
        'cols': COLS,
        'total_multiplier': str(game.total_multiplier),
        'payout': str(game.payout),
        'profit': str(game.profit),
        'board': serialize_board(game),
        'balance': str(player.balance),
        'player_id': str(player.id),
    }


@transaction.atomic
def ensure_selecting_game(player: Player) -> Game:
    player = Player.objects.select_for_update().get(pk=player.pk)
    game = (
        Game.objects.filter(player=player, status=Game.Status.SELECTING)
        .order_by('-created_at')
        .first()
    )
    if game:
        return game
    return Game.objects.create(player=player, selected=[], status=Game.Status.SELECTING)


@transaction.atomic
def toggle_select(game: Game, index: int) -> Game:
    game = Game.objects.select_for_update().get(pk=game.pk)
    if game.status != Game.Status.SELECTING:
        raise ValidationError({'detail': 'Selection is locked for this round.'})

    if index < 0 or index >= GRID:
        raise ValidationError({'index': f'Must be between 0 and {GRID - 1}.'})

    selected = list(game.selected)
    if index in selected:
        selected.remove(index)
    else:
        if len(selected) >= PICK:
            raise ValidationError({'detail': f'Select exactly {PICK} boxes.'})
        selected.append(index)

    game.selected = selected
    game.save(update_fields=['selected'])
    return game


@transaction.atomic
def place_bet(game: Game, bet_amount: Decimal) -> Game:
    game = Game.objects.select_for_update().select_related('player').get(pk=game.pk)
    if game.status != Game.Status.SELECTING:
        raise ValidationError({'detail': 'Round already settled. Start a new selection.'})

    if len(game.selected) != PICK:
        raise ValidationError({'detail': f'Select exactly {PICK} boxes before betting.'})

    min_bet = money(settings.BOXES_MIN_BET)
    max_bet = money(settings.BOXES_MAX_BET)
    bet = money(bet_amount)
    if bet < min_bet or bet > max_bet:
        raise ValidationError(
            {'bet_amount': f'Must be between ₹{min_bet} and ₹{max_bet}.'}
        )

    player = Player.objects.select_for_update().get(pk=game.player_id)
    if player.balance < bet:
        raise ValidationError({'bet_amount': 'Insufficient balance.'})

    multipliers = generate_board()
    total = sum(
        (Decimal(str(multipliers[i])) for i in game.selected),
        Decimal('0'),
    ).quantize(FOUR, rounding=ROUND_HALF_UP)
    payout = money(bet * total)
    profit = money(payout - bet)

    player.balance = money(player.balance - bet + payout)
    player.save(update_fields=['balance', 'updated_at'])

    game.bet_amount = bet
    game.multipliers = multipliers
    game.total_multiplier = total
    game.payout = payout
    game.profit = profit
    game.status = Game.Status.SETTLED
    game.finished_at = timezone.now()
    game.save()
    return game


@transaction.atomic
def new_round(player: Player) -> Game:
    player = Player.objects.select_for_update().get(pk=player.pk)
    Game.objects.filter(player=player, status=Game.Status.SELECTING).delete()
    return Game.objects.create(player=player, selected=[], status=Game.Status.SELECTING)
