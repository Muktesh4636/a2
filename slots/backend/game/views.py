import json
from decimal import InvalidOperation

from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .engine import list_games, load_config, money, public_config, resolve_spin
from .models import Player, Spin


def _body(request):
    try:
        return json.loads(request.body.decode() or '{}')
    except Exception:
        return None


def _err(msg, status=400):
    return JsonResponse({'detail': msg}, status=status)


def _feature(player: Player, game_id: str) -> dict:
    state = player.feature_state or {}
    entry = state.get(game_id) or {}
    return {
        'free_spins': int(entry.get('free_spins') or 0),
        'pearls': int(entry.get('pearls') or 0),
    }


def _set_feature(player: Player, game_id: str, free_spins: int, pearls: int) -> None:
    state = dict(player.feature_state or {})
    state[game_id] = {'free_spins': int(free_spins), 'pearls': int(pearls)}
    player.feature_state = state


@require_GET
def health(request):
    return JsonResponse({'ok': True, 'games': len(list_games())})


@require_GET
def games_list(request):
    games = []
    for gid in list_games():
        cfg = load_config(gid)
        games.append({
            'id': gid,
            'title': cfg.get('title', gid),
            'cols': cfg['cols'],
            'rows': cfg['rows'],
            'mode': cfg.get('mode', 'lines'),
            'bets': cfg['bets'],
        })
    return JsonResponse({'games': games, 'currency': getattr(settings, 'GAME_CURRENCY', 'INR')})


@require_GET
def game_config(request, game_id):
    try:
        return JsonResponse(public_config(game_id))
    except KeyError:
        return _err('Unknown game', 404)


@csrf_exempt
@require_http_methods(['POST'])
def session_create(request):
    initial = money(getattr(settings, 'GAME_INITIAL_BALANCE', '10000.00'))
    p = Player.objects.create(balance=initial)
    return JsonResponse({
        'player_id': str(p.id),
        'balance': str(p.balance),
        'currency': getattr(settings, 'GAME_CURRENCY', 'INR'),
    }, status=201)


@require_GET
def session_detail(request, player_id):
    p = get_object_or_404(Player, pk=player_id)
    game_id = request.GET.get('game_id')
    payload = {
        'player_id': str(p.id),
        'balance': str(p.balance),
        'currency': getattr(settings, 'GAME_CURRENCY', 'INR'),
    }
    if game_id:
        feat = _feature(p, game_id)
        payload.update(feat)
    return JsonResponse(payload)


@csrf_exempt
@require_http_methods(['POST'])
def spin_view(request):
    body = _body(request)
    if body is None:
        return _err('Invalid JSON')

    game_id = body.get('game_id')
    player_id = body.get('player_id')
    if not game_id:
        return _err('game_id required')
    if not player_id:
        return _err('player_id required')

    try:
        load_config(game_id)
    except KeyError:
        return _err('Unknown game', 404)

    try:
        bet = money(body.get('bet_amount'))
    except (InvalidOperation, TypeError, ValueError):
        return _err('Invalid bet_amount')

    min_bet = money(getattr(settings, 'GAME_MIN_BET', '0.20'))
    max_bet = money(getattr(settings, 'GAME_MAX_BET', '500.00'))
    if bet < min_bet or bet > max_bet:
        return _err(f'Bet must be ₹{min_bet}–₹{max_bet}')

    try:
        with transaction.atomic():
            p = Player.objects.select_for_update().get(pk=player_id)
            feat = _feature(p, game_id)
            free_left = feat['free_spins']
            pearls = feat['pearls']

            result = resolve_spin(
                game_id,
                bet,
                free_spins_left=free_left,
                pearls=pearls,
            )

            using_free = result['used_free_spin']
            if not using_free:
                if bet > p.balance:
                    return _err('Insufficient balance')
                p.balance = money(p.balance - bet)

            p.balance = money(p.balance + result['payout'])
            _set_feature(p, game_id, result['free_spins'], result['pearls'])
            p.save(update_fields=['balance', 'feature_state', 'updated_at'])

            spin = Spin.objects.create(
                player=p,
                game_id=game_id,
                bet_amount=bet if not using_free else money(0),
                payout=result['payout'],
                used_free_spin=using_free,
                grid_json=json.dumps(result['grid']),
                result_json=json.dumps({
                    'final_grid': result['final_grid'],
                    'win_cells': result['win_cells'],
                    'line_wins': [
                        {**lw, 'win': str(lw['win']), 'multiplier': str(lw.get('multiplier', 0))}
                        for lw in result.get('line_wins') or []
                    ],
                    'ways_wins': [
                        {
                            **ww,
                            'win': str(ww['win']),
                            'multiplier': str(ww.get('multiplier', 0)),
                        }
                        for ww in result.get('ways_wins') or []
                    ],
                    'cascades': result.get('cascades') or [],
                    'bonus': str(result.get('bonus') or 0),
                }, default=str),
                balance_after=p.balance,
                free_spins_after=result['free_spins'],
                pearls_after=result['pearls'],
            )
    except Player.DoesNotExist:
        return _err('Player not found', 404)
    except ValueError as e:
        return _err(str(e))

    return JsonResponse({
        'spin_id': str(spin.id),
        'game_id': game_id,
        'bet_amount': str(bet),
        'used_free_spin': result['used_free_spin'],
        'grid': result['grid'],
        'final_grid': result['final_grid'],
        'payout': str(result['payout']),
        'bonus': str(result.get('bonus') or 0),
        'win_cells': result['win_cells'],
        'line_wins': [
            {
                **lw,
                'win': str(lw['win']),
                'multiplier': str(lw.get('multiplier', 0)),
            }
            for lw in result.get('line_wins') or []
        ],
        'ways_wins': [
            {
                **ww,
                'win': str(ww['win']),
                'multiplier': str(ww.get('multiplier', 0)),
            }
            for ww in result.get('ways_wins') or []
        ],
        'cascades': [
            {
                **c,
                'payout': str(c['payout']),
            }
            for c in (result.get('cascades') or [])
        ],
        'scatter_count': result.get('scatter_count') or 0,
        'pearls': result['pearls'],
        'free_spins': result['free_spins'],
        'free_spins_awarded': result['free_spins_awarded'],
        'balance': str(p.balance),
        'mode': result['mode'],
    })
