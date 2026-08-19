import json
from decimal import InvalidOperation
from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods
from .engine import generate_crash, money
from .models import Player, Round

def _body(r):
    try: return json.loads(r.body.decode() or '{}')
    except Exception: return None
def _err(m, s=400): return JsonResponse({'detail': m}, status=s)

@require_GET
def config_view(request):
    return JsonResponse({'currency': 'INR'})

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
def round_start(request):
    body = _body(request)
    if body is None: return _err('Invalid JSON')
    try: bet = money(body.get('bet_amount'))
    except (InvalidOperation, TypeError, ValueError): return _err('Invalid bet')
    pid = body.get('player_id')
    if not pid: return _err('player_id required')
    if bet < money('1') or bet > money('500'): return _err('Bet ₹1–₹500')
    try:
        with transaction.atomic():
            p = Player.objects.select_for_update().get(pk=pid)
            if bet > p.balance: return _err('Insufficient balance')
            Round.objects.filter(player=p, status='active').update(status='crashed')
            p.balance = money(p.balance - bet)
            p.save(update_fields=['balance', 'updated_at'])
            crash = generate_crash()
            rnd = Round.objects.create(player=p, bet_amount=bet, crash_at=crash)
    except Player.DoesNotExist:
        return _err('Player not found', 404)
    return JsonResponse({
        'round_id': str(rnd.id),
        'balance': str(p.balance),
    })


@csrf_exempt
@require_http_methods(['POST'])
def tick_view(request):
    body = _body(request)
    if body is None:
        return _err('Invalid JSON')
    rid = body.get('round_id')
    try:
        claimed = float(body.get('multiplier'))
    except (TypeError, ValueError):
        return _err('Invalid multiplier')
    with transaction.atomic():
        rnd = get_object_or_404(Round.objects.select_for_update(), pk=rid)
        if rnd.status != 'active':
            return JsonResponse({'status': rnd.status})
        if claimed >= rnd.crash_at:
            rnd.status = 'crashed'
            rnd.save(update_fields=['status', 'updated_at'])
            return JsonResponse({'status': 'crashed'})
    return JsonResponse({'status': 'active'})


@csrf_exempt
@require_http_methods(['POST'])
def cashout_view(request):
    body = _body(request)
    if body is None: return _err('Invalid JSON')
    rid = body.get('round_id')
    try:
        claimed = float(body.get('multiplier'))
    except (TypeError, ValueError):
        return _err('Invalid multiplier')
    if claimed < 1.01:
        return _err('Multiplier too low')
    with transaction.atomic():
        rnd = get_object_or_404(Round.objects.select_for_update(), pk=rid)
        if rnd.status != 'active':
            return _err('Round is over')
        # Small grace: allow cashout if claimed is under crash (with tiny epsilon)
        if claimed >= rnd.crash_at:
            rnd.status = 'crashed'
            rnd.save(update_fields=['status', 'updated_at'])
            return _err('Already crashed')
        mult = money(claimed)
        payout = money(rnd.bet_amount * mult)
        player = Player.objects.select_for_update().get(pk=rnd.player_id)
        player.balance = money(player.balance + payout)
        player.save(update_fields=['balance', 'updated_at'])
        rnd.status = 'cashed'
        rnd.cashout_mult = mult
        rnd.payout = payout
        rnd.save()
    return JsonResponse({
        'status': 'cashed',
        'multiplier': str(mult),
        'payout': str(payout),
        'balance': str(player.balance),
    })
