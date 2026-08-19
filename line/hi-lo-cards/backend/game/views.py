import json
from decimal import InvalidOperation
from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods
from .engine import deal_card, label_rank, money, multiplier_for_streak, next_multiplier
from .models import Player, Round


def _body(r):
    try:
        return json.loads(r.body.decode() or '{}')
    except Exception:
        return None


def _err(m, s=400):
    return JsonResponse({'detail': m}, status=s)


def _card(rank: int, suit: str) -> dict:
    return {
        'rank': rank,
        'suit': suit,
        'label': label_rank(rank),
        'red': suit in ('H', 'D'),
    }


@require_GET
def config_view(request):
    return JsonResponse({'currency': 'INR'})


@csrf_exempt
@require_http_methods(['POST'])
def session_create(request):
    p = Player.objects.create(balance=money(getattr(settings, 'GAME_INITIAL_BALANCE', '1000.00')))
    return JsonResponse({
        'player_id': str(p.id),
        'balance': str(p.balance),
        'best_streak_mult': str(p.best_streak_mult),
        'total_wins': str(p.total_wins),
    }, status=201)


@require_GET
def session_detail(request, player_id):
    p = get_object_or_404(Player, pk=player_id)
    return JsonResponse({
        'player_id': str(p.id),
        'balance': str(p.balance),
        'best_streak_mult': str(p.best_streak_mult),
        'total_wins': str(p.total_wins),
    })


@csrf_exempt
@require_http_methods(['POST'])
def round_start(request):
    body = _body(request)
    if body is None:
        return _err('Invalid JSON')
    pid = body.get('player_id')
    try:
        bet = money(body.get('bet_amount'))
        auto = money(body.get('auto_cashout') or 0)
    except (InvalidOperation, TypeError, ValueError):
        return _err('Invalid bet')
    if not pid:
        return _err('player_id required')
    if bet < money('1') or bet > money('500'):
        return _err('Bet ₹1–₹500')
    card = deal_card()
    try:
        with transaction.atomic():
            p = Player.objects.select_for_update().get(pk=pid)
            if bet > p.balance:
                return _err('Insufficient balance')
            Round.objects.filter(player=p, status='active').update(status='bust')
            p.balance = money(p.balance - bet)
            p.save(update_fields=['balance', 'updated_at'])
            rnd = Round.objects.create(
                player=p,
                bet_amount=bet,
                card_rank=card['rank'],
                card_suit=card['suit'],
                auto_cashout=auto,
            )
    except Player.DoesNotExist:
        return _err('Player not found', 404)
    return JsonResponse({
        'round_id': str(rnd.id),
        'card': _card(rnd.card_rank, rnd.card_suit),
        'streak': 0,
        'multiplier': '0.00',
        'next_multiplier': str(next_multiplier(0)),
        'balance': str(p.balance),
        'status': 'active',
        'potential': '0.00',
    })


def _maybe_autcash(rnd: Round, player: Player, mult):
    if rnd.auto_cashout <= 0:
        return None
    if mult < rnd.auto_cashout:
        return None
    payout = money(rnd.bet_amount * mult)
    player.balance = money(player.balance + payout)
    player.total_wins = money(player.total_wins + payout)
    if mult > player.best_streak_mult:
        player.best_streak_mult = mult
    player.save(update_fields=['balance', 'total_wins', 'best_streak_mult', 'updated_at'])
    rnd.status = 'cashed'
    rnd.save()
    return payout


@csrf_exempt
@require_http_methods(['POST'])
def guess_view(request):
    body = _body(request)
    if body is None:
        return _err('Invalid JSON')
    round_id = body.get('round_id')
    choice = (body.get('choice') or '').lower()
    if choice not in ('higher', 'lower'):
        return _err('choice must be higher or lower')
    with transaction.atomic():
        rnd = get_object_or_404(Round.objects.select_for_update(), pk=round_id)
        if rnd.status != 'active':
            return _err('Round is over')
        prev = rnd.card_rank
        nxt = deal_card({(rnd.card_rank, rnd.card_suit)})
        win = (choice == 'higher' and nxt['rank'] > prev) or (
            choice == 'lower' and nxt['rank'] < prev
        )
        # equal ranks count as loss
        rnd.card_rank = nxt['rank']
        rnd.card_suit = nxt['suit']
        if not win:
            rnd.status = 'bust'
            rnd.save()
            return JsonResponse({
                'card': _card(nxt['rank'], nxt['suit']),
                'prev_rank': prev,
                'choice': choice,
                'result': 'lose',
                'streak': rnd.streak,
                'multiplier': '0.00',
                'payout': '0.00',
                'balance': str(rnd.player.balance),
                'status': 'bust',
                'best_streak_mult': str(rnd.player.best_streak_mult),
                'total_wins': str(rnd.player.total_wins),
            })

        rnd.streak += 1
        mult = multiplier_for_streak(rnd.streak)
        player = Player.objects.select_for_update().get(pk=rnd.player_id)
        auto_payout = _maybe_autcash(rnd, player, mult)
        if auto_payout is not None:
            return JsonResponse({
                'card': _card(nxt['rank'], nxt['suit']),
                'prev_rank': prev,
                'choice': choice,
                'result': 'win',
                'streak': rnd.streak,
                'multiplier': str(mult),
                'payout': str(auto_payout),
                'balance': str(player.balance),
                'status': 'cashed',
                'auto': True,
                'best_streak_mult': str(player.best_streak_mult),
                'total_wins': str(player.total_wins),
                'next_multiplier': str(next_multiplier(rnd.streak)),
            })
        rnd.save()
        return JsonResponse({
            'card': _card(nxt['rank'], nxt['suit']),
            'prev_rank': prev,
            'choice': choice,
            'result': 'win',
            'streak': rnd.streak,
            'multiplier': str(mult),
            'payout': str(money(rnd.bet_amount * mult)),
            'potential': str(money(rnd.bet_amount * mult)),
            'balance': str(player.balance),
            'status': 'active',
            'next_multiplier': str(next_multiplier(rnd.streak)),
            'best_streak_mult': str(player.best_streak_mult),
            'total_wins': str(player.total_wins),
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
        if rnd.streak < 1:
            return _err('Win at least one guess first')
        mult = multiplier_for_streak(rnd.streak)
        payout = money(rnd.bet_amount * mult)
        player = Player.objects.select_for_update().get(pk=rnd.player_id)
        player.balance = money(player.balance + payout)
        player.total_wins = money(player.total_wins + payout)
        if mult > player.best_streak_mult:
            player.best_streak_mult = mult
        player.save(update_fields=['balance', 'total_wins', 'best_streak_mult', 'updated_at'])
        rnd.status = 'cashed'
        rnd.save()
        return JsonResponse({
            'multiplier': str(mult),
            'payout': str(payout),
            'balance': str(player.balance),
            'status': 'cashed',
            'best_streak_mult': str(player.best_streak_mult),
            'total_wins': str(player.total_wins),
            'card': _card(rnd.card_rank, rnd.card_suit),
        })
