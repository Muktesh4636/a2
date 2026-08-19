import json
from decimal import InvalidOperation
from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods
from .engine import DRAW_COUNT, MAX_PICKS, MIN_PICKS, POOL, money, payout_table, resolve_play
from .models import Play, Player


def _body(r):
    try:
        return json.loads(r.body.decode() or '{}')
    except Exception:
        return None


def _err(m, s=400):
    return JsonResponse({'detail': m}, status=s)


@require_GET
def config_view(request):
    pick = int(request.GET.get('picks', 6) or 6)
    pick = max(MIN_PICKS, min(MAX_PICKS, pick))
    return JsonResponse({
        'currency': 'INR',
        'pool': POOL,
        'draw_count': DRAW_COUNT,
        'min_picks': MIN_PICKS,
        'max_picks': MAX_PICKS,
        'table': payout_table(pick),
    })


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
    try:
        bet = money(body.get('bet_amount'))
    except (InvalidOperation, TypeError, ValueError):
        return _err('Invalid bet')
    pid = body.get('player_id')
    picks = body.get('picks') or []
    if not pid:
        return _err('player_id required')
    if bet < money('1') or bet > money('500'):
        return _err('Bet ₹1–₹500')
    try:
        with transaction.atomic():
            p = Player.objects.select_for_update().get(pk=pid)
            if bet > p.balance:
                return _err('Insufficient balance')
            result = resolve_play(picks, bet)
            p.balance = money(p.balance - bet + result['payout'])
            p.save(update_fields=['balance', 'updated_at'])
            play = Play.objects.create(
                player=p,
                bet_amount=bet,
                picks_json=json.dumps(result['picks']),
                drawn_json=json.dumps(result['drawn']),
                hit_count=result['hit_count'],
                multiplier=result['multiplier'],
                payout=result['payout'],
                balance_after=p.balance,
            )
    except Player.DoesNotExist:
        return _err('Player not found', 404)
    except ValueError as e:
        return _err(str(e))
    return JsonResponse({
        'play_id': str(play.id),
        'picks': result['picks'],
        'drawn': result['drawn'],
        'hits': result['hits'],
        'hit_count': result['hit_count'],
        'multiplier': str(result['multiplier']),
        'payout': str(result['payout']),
        'balance': str(p.balance),
        'table': result['table'],
    })
