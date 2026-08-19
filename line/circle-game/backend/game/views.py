import json
from decimal import InvalidOperation

from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .engine import money, public_config, resolve_spin
from .models import Player, Spin


def _json_body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def _error(message: str, status: int = 400):
    return JsonResponse({'detail': message}, status=status)


@require_GET
def config_view(request):
    return JsonResponse(public_config())


@csrf_exempt
@require_http_methods(['POST'])
def session_create(request):
    initial = money(getattr(settings, 'GAME_INITIAL_BALANCE', '1000.00'))
    player = Player.objects.create(balance=initial)
    return JsonResponse(
        {
            'player_id': str(player.id),
            'balance': str(player.balance),
            'currency': 'INR',
            'currency_symbol': '₹',
        },
        status=201,
    )


@require_GET
def session_detail(request, player_id):
    player = get_object_or_404(Player, pk=player_id)
    last = player.spins.first()
    payload = {
        'player_id': str(player.id),
        'balance': str(player.balance),
        'currency': 'INR',
        'currency_symbol': '₹',
        'last_spin': None,
    }
    if last:
        payload['last_spin'] = {
            'segment_id': last.segment_id,
            'multiplier': str(last.multiplier),
            'payout': str(last.payout),
            'bet_amount': str(last.bet_amount),
            'target_angle': last.target_angle,
        }
    return JsonResponse(payload)


@csrf_exempt
@require_http_methods(['POST'])
def spin_view(request):
    body = _json_body(request)
    if body is None:
        return _error('Invalid JSON body.')

    player_id = body.get('player_id')
    raw_bet = body.get('bet_amount')

    if not player_id:
        return _error('player_id is required.')
    if raw_bet is None:
        return _error('bet_amount is required.')

    try:
        bet_amount = money(raw_bet)
    except (InvalidOperation, TypeError, ValueError):
        return _error('Invalid bet_amount.')

    min_bet = money(getattr(settings, 'GAME_MIN_BET', '1.00'))
    max_bet = money(getattr(settings, 'GAME_MAX_BET', '500.00'))

    if bet_amount < min_bet:
        return _error(f'Minimum bet is ₹{min_bet}.')
    if bet_amount > max_bet:
        return _error(f'Maximum bet is ₹{max_bet}.')

    try:
        with transaction.atomic():
            player = Player.objects.select_for_update().get(pk=player_id)
            if bet_amount > player.balance:
                return _error('Insufficient balance.')

            result = resolve_spin(bet_amount)
            player.balance = money(player.balance - bet_amount + result['payout'])
            player.save(update_fields=['balance', 'updated_at'])

            spin = Spin.objects.create(
                player=player,
                bet_amount=bet_amount,
                segment_id=result['segment_id'],
                multiplier=result['multiplier'],
                payout=result['payout'],
                target_angle=result['target_angle'],
                balance_after=player.balance,
            )
    except Player.DoesNotExist:
        return _error('Player not found.', status=404)

    return JsonResponse(
        {
            'spin_id': str(spin.id),
            'player_id': str(player.id),
            'bet_amount': str(bet_amount),
            'segment_id': result['segment_id'],
            'color': result['color'],
            'multiplier': str(result['multiplier']),
            'payout': str(result['payout']),
            'target_angle': result['target_angle'],
            'balance': str(player.balance),
            'currency': 'INR',
            'currency_symbol': '₹',
        }
    )


@require_GET
def spin_history(request, player_id):
    player = get_object_or_404(Player, pk=player_id)
    spins = player.spins.all()[:50]
    return JsonResponse(
        [
            {
                'spin_id': str(s.id),
                'bet_amount': str(s.bet_amount),
                'segment_id': s.segment_id,
                'multiplier': str(s.multiplier),
                'payout': str(s.payout),
                'target_angle': s.target_angle,
                'balance_after': str(s.balance_after),
                'created_at': s.created_at.isoformat(),
            }
            for s in spins
        ],
        safe=False,
    )
