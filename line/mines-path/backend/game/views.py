import json
from decimal import InvalidOperation
from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods
from .engine import (
    MINE_COUNT, TILE_COUNT, make_mines, mines_from_json, money,
    multiplier_for_safes, next_multiplier,
)
from .models import Player, Round


def _body(request):
    try:
        return json.loads(request.body.decode() or '{}')
    except Exception:
        return None


def _err(msg, status=400):
    return JsonResponse({'detail': msg}, status=status)


def _tile_map(round_obj: Round, reveal_all=False):
    mines = set(mines_from_json(round_obj.mines_json))
    revealed = set(json.loads(round_obj.revealed_json))
    out = []
    for i in range(TILE_COUNT):
        if reveal_all or i in revealed:
            out.append('mine' if i in mines else 'safe')
        else:
            out.append('hidden')
    return out


@require_GET
def config_view(request):
    return JsonResponse({
        'tile_count': TILE_COUNT,
        'mine_count': MINE_COUNT,
        'currency': 'INR',
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
def round_start(request):
    body = _body(request)
    if body is None:
        return _err('Invalid JSON')
    player_id = body.get('player_id')
    try:
        bet = money(body.get('bet_amount'))
    except (InvalidOperation, TypeError, ValueError):
        return _err('Invalid bet')
    if not player_id:
        return _err('player_id required')
    if bet < money('1') or bet > money('500'):
        return _err('Bet must be ₹1–₹500')
    try:
        with transaction.atomic():
            p = Player.objects.select_for_update().get(pk=player_id)
            if bet > p.balance:
                return _err('Insufficient balance')
            # cancel any prior active round without refund (already deducted only on start)
            Round.objects.filter(player=p, status='active').update(status='bust')
            p.balance = money(p.balance - bet)
            p.save(update_fields=['balance', 'updated_at'])
            rnd = Round.objects.create(
                player=p,
                bet_amount=bet,
                mines_json=json.dumps(make_mines()),
                revealed_json='[]',
            )
    except Player.DoesNotExist:
        return _err('Player not found', 404)
    return JsonResponse({
        'round_id': str(rnd.id),
        'tile_count': TILE_COUNT,
        'mine_count': MINE_COUNT,
        'balance': str(p.balance),
        'next_multiplier': str(next_multiplier(0)),
    })


@csrf_exempt
@require_http_methods(['POST'])
def reveal_view(request):
    body = _body(request)
    if body is None:
        return _err('Invalid JSON')
    round_id = body.get('round_id')
    try:
        index = int(body.get('index'))
    except (TypeError, ValueError):
        return _err('Invalid index')
    if index < 0 or index >= TILE_COUNT:
        return _err('Index out of range')

    with transaction.atomic():
        rnd = get_object_or_404(Round.objects.select_for_update(), pk=round_id)
        if rnd.status != 'active':
            return _err('Round is over')
        revealed = json.loads(rnd.revealed_json)
        if index in revealed:
            return _err('Already revealed')
        mines = set(mines_from_json(rnd.mines_json))
        revealed.append(index)
        rnd.revealed_json = json.dumps(revealed)

        if index in mines:
            rnd.status = 'bust'
            rnd.save()
            return JsonResponse({
                'index': index,
                'result': 'mine',
                'safe_count': rnd.safe_count,
                'multiplier': '0.00',
                'payout': '0.00',
                'balance': str(rnd.player.balance),
                'status': 'bust',
                'tiles': _tile_map(rnd, reveal_all=True),
            })

        rnd.safe_count += 1
        mult = multiplier_for_safes(rnd.safe_count)
        rnd.save()
        return JsonResponse({
            'index': index,
            'result': 'safe',
            'safe_count': rnd.safe_count,
            'multiplier': str(mult),
            'payout': str(money(rnd.bet_amount * mult)),
            'balance': str(rnd.player.balance),
            'status': 'active',
        })


@csrf_exempt
@require_http_methods(['POST'])
def cashout_view(request):
    body = _body(request)
    if body is None:
        return _err('Invalid JSON')
    round_id = body.get('round_id')
    with transaction.atomic():
        rnd = get_object_or_404(Round.objects.select_for_update(), pk=round_id)
        if rnd.status != 'active':
            return _err('Round is over')
        if rnd.safe_count < 1:
            return _err('Reveal at least one safe tile')
        mult = multiplier_for_safes(rnd.safe_count)
        payout = money(rnd.bet_amount * mult)
        player = Player.objects.select_for_update().get(pk=rnd.player_id)
        player.balance = money(player.balance + payout)
        player.save(update_fields=['balance', 'updated_at'])
        rnd.status = 'cashed'
        rnd.save()
        return JsonResponse({
            'multiplier': str(mult),
            'payout': str(payout),
            'balance': str(player.balance),
            'status': 'cashed',
            'tiles': _tile_map(rnd, reveal_all=True),
        })
