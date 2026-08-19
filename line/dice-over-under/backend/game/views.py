import json
from decimal import InvalidOperation
from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods
from .engine import money, resolve_play
from .models import Play, Player


def _body(request):
    try:
        return json.loads(request.body.decode() or '{}')
    except Exception:
        return None


def _err(msg, status=400):
    return JsonResponse({'detail': msg}, status=status)


@require_GET
def config_view(request):
    return JsonResponse({'currency': 'INR', 'min_target': 2, 'max_target': 98})


@csrf_exempt
@require_http_methods(['POST'])
def session_create(request):
    p = Player.objects.create(balance=money(getattr(settings, 'GAME_INITIAL_BALANCE', '1000.00')))
    return JsonResponse({'player_id': str(p.id), 'balance': str(p.balance)}, status=201)


@require_GET
def session_detail(request, player_id):
    p = get_object_or_404(Player, pk=player_id)
    return JsonResponse({'player_id': str(p.id), 'balance': str(p.balance)})


@csrf_exempt
@require_http_methods(['POST'])
def play_view(request):
    body = _body(request)
    if body is None:
        return _err('Invalid JSON')
    player_id = body.get('player_id')
    side = body.get('side')
    try:
        bet = money(body.get('bet_amount'))
        target = int(body.get('target'))
    except (InvalidOperation, TypeError, ValueError):
        return _err('Invalid bet/target')
    if not player_id:
        return _err('player_id required')
    if side not in ('under', 'over'):
        return _err('side must be under or over')
    if bet < money('1') or bet > money('500'):
        return _err('Bet must be ₹1–₹500')
    try:
        with transaction.atomic():
            p = Player.objects.select_for_update().get(pk=player_id)
            if bet > p.balance:
                return _err('Insufficient balance')
            result = resolve_play(bet, target, side)
            p.balance = money(p.balance - bet + result['payout'])
            p.save(update_fields=['balance', 'updated_at'])
            play = Play.objects.create(
                player=p, bet_amount=bet, target=result['target'], side=side,
                roll=money(result['roll']), won=result['won'],
                multiplier=result['multiplier'], payout=result['payout'],
                balance_after=p.balance,
            )
    except Player.DoesNotExist:
        return _err('Player not found', 404)
    except ValueError as e:
        return _err(str(e))
    return JsonResponse({
        'play_id': str(play.id),
        'roll': result['roll'],
        'won': result['won'],
        'multiplier': str(result['multiplier']),
        'payout': str(result['payout']),
        'balance': str(p.balance),
        'target': result['target'],
        'side': side,
    })
