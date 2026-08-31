from __future__ import annotations

import secrets
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from .models import Bet, GameRound, Player
from . import gundu_wallet

MIN_BET = Decimal('10')
MAX_BET = Decimal('10000')
START_BALANCE = Decimal('5000.00')
GAME_SLUG = 'ufo-lift'


def get_or_create_player(token: str | None) -> Player:
    if token:
        player = Player.objects.filter(token=token).first()
        if player:
            return player
    token = secrets.token_hex(16)
    return Player.objects.create(token=token, balance=START_BALANCE)


def get_or_create_gundu_player(jwt: str) -> Player:
    """Link player to real Gundu wallet via JWT."""
    uid, bal = gundu_wallet.fetch_balance(jwt)
    token = f'gundu:{uid}'
    player, created = Player.objects.get_or_create(
        token=token,
        defaults={'balance': bal, 'currency': 'INR'},
    )
    if not created and player.balance != bal:
        player.balance = bal
        player.save(update_fields=['balance', 'updated_at'])
    return player


def sync_player_balance(player: Player, jwt: str | None) -> Player:
    if not jwt or not player.token.startswith('gundu:'):
        return player
    try:
        _, bal = gundu_wallet.fetch_balance(jwt)
        if player.balance != bal:
            player.balance = bal
            player.save(update_fields=['balance', 'updated_at'])
    except Exception:
        pass
    return player


def latest_history(limit: int = 30) -> list[float]:
    rounds = (
        GameRound.objects.filter(status=GameRound.Status.CRASHED)
        .order_by('-crashed_at', '-created_at')[:limit]
    )
    return [float(r.crash_point) for r in rounds]


@transaction.atomic
def ensure_open_round() -> GameRound:
    """Return the current waiting/flying round, or create a new waiting one."""
    current = (
        GameRound.objects.filter(status__in=[GameRound.Status.WAITING, GameRound.Status.FLYING])
        .order_by('-created_at')
        .first()
    )
    if current:
        return current
    return GameRound.objects.create(
        status=GameRound.Status.WAITING,
        crash_point=GameRound.sample_crash_point(),
        seed=secrets.token_hex(16),
    )


@transaction.atomic
def place_bet(
    player: Player,
    panel: int,
    amount: Decimal,
    auto_cashout: Decimal | None = None,
    jwt: str | None = None,
) -> Bet:
    if amount < MIN_BET or amount > MAX_BET:
        raise ValueError(f'Bet must be between {MIN_BET} and {MAX_BET}')
    if panel not in (0, 1):
        raise ValueError('panel must be 0 or 1')

    round_obj = ensure_open_round()
    if round_obj.status != GameRound.Status.WAITING:
        raise ValueError('Bets are only accepted while waiting')

    player = Player.objects.select_for_update().get(pk=player.pk)
    linked = bool(jwt and player.token.startswith('gundu:'))

    # Cancel existing pending bet on this panel for this round
    existing = Bet.objects.filter(
        player=player,
        round=round_obj,
        panel=panel,
        status=Bet.Status.PENDING,
    ).first()
    if existing:
        refund = existing.amount
        if linked:
            player.balance = gundu_wallet.adjust_balance(
                jwt, refund, game=GAME_SLUG, reason='REFUND', ref=f'cancel:{existing.id}'
            )
        else:
            player.balance = player.balance + refund
            player.save(update_fields=['balance', 'updated_at'])
        existing.status = Bet.Status.CANCELLED
        existing.save(update_fields=['status', 'updated_at'])
        if linked:
            player.save(update_fields=['balance', 'updated_at'])
        return existing

    if linked:
        try:
            player.balance = gundu_wallet.adjust_balance(
                jwt, -amount, game=GAME_SLUG, reason='BET', ref=f'panel:{panel}'
            )
            player.save(update_fields=['balance', 'updated_at'])
        except gundu_wallet.WalletBridgeError as exc:
            raise ValueError(exc.message) from exc
    else:
        if player.balance < amount:
            raise ValueError('Insufficient balance')
        player.balance = player.balance - amount
        player.save(update_fields=['balance', 'updated_at'])

    return Bet.objects.create(
        player=player,
        round=round_obj,
        panel=panel,
        amount=amount,
        status=Bet.Status.PENDING,
        auto_cashout=auto_cashout,
    )


@transaction.atomic
def start_round(round_id: str | None = None) -> GameRound:
    if round_id:
        round_obj = GameRound.objects.select_for_update().get(id=round_id)
    else:
        round_obj = ensure_open_round()
        round_obj = GameRound.objects.select_for_update().get(id=round_obj.id)

    if round_obj.status != GameRound.Status.WAITING:
        return round_obj

    round_obj.status = GameRound.Status.FLYING
    round_obj.started_at = timezone.now()
    round_obj.save(update_fields=['status', 'started_at'])

    Bet.objects.filter(round=round_obj, status=Bet.Status.PENDING).update(
        status=Bet.Status.ACTIVE
    )
    return round_obj


@transaction.atomic
def cash_out(player: Player, panel: int, mult: Decimal, jwt: str | None = None) -> Bet:
    round_obj = (
        GameRound.objects.filter(status=GameRound.Status.FLYING)
        .order_by('-created_at')
        .first()
    )
    if not round_obj:
        raise ValueError('No active flight')

    if mult < Decimal('1.01') or mult > round_obj.crash_point:
        raise ValueError('Invalid cashout multiplier')

    player = Player.objects.select_for_update().get(pk=player.pk)
    bet = (
        Bet.objects.select_for_update()
        .filter(
            player=player,
            round=round_obj,
            panel=panel,
            status=Bet.Status.ACTIVE,
        )
        .first()
    )
    if not bet:
        raise ValueError('No active bet on this panel')

    win = (bet.amount * mult).quantize(Decimal('0.01'))
    bet.status = Bet.Status.CASHED
    bet.cashout_mult = mult
    bet.win = win
    bet.save(update_fields=['status', 'cashout_mult', 'win', 'updated_at'])

    linked = bool(jwt and player.token.startswith('gundu:'))
    if linked:
        try:
            player.balance = gundu_wallet.adjust_balance(
                jwt, win, game=GAME_SLUG, reason='WIN', ref=f'cashout:{bet.id}'
            )
        except gundu_wallet.WalletBridgeError as exc:
            raise ValueError(exc.message) from exc
    else:
        player.balance = player.balance + win
    player.save(update_fields=['balance', 'updated_at'])
    return bet


@transaction.atomic
def crash_round(round_id: str | None = None) -> GameRound:
    if round_id:
        round_obj = GameRound.objects.select_for_update().get(id=round_id)
    else:
        round_obj = (
            GameRound.objects.select_for_update()
            .filter(status=GameRound.Status.FLYING)
            .order_by('-created_at')
            .first()
        )
        if not round_obj:
            raise ValueError('No flying round')

    if round_obj.status != GameRound.Status.FLYING:
        return round_obj

    round_obj.status = GameRound.Status.CRASHED
    round_obj.crashed_at = timezone.now()
    round_obj.save(update_fields=['status', 'crashed_at'])

    Bet.objects.filter(round=round_obj, status=Bet.Status.ACTIVE).update(
        status=Bet.Status.LOST,
        win=Decimal('0'),
    )
    return round_obj
