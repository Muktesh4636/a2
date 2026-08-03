"""Per-game stats helpers for the admin Games pages."""
from datetime import datetime, time, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.core.paginator import Paginator
from django.db.models import Count, Sum, Q, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.urls import reverse

from accounts.models import Transaction
from .models import (
    Bet,
    GameRound,
    RouletteRound,
    RoulettePendingBet,
    RouletteSettledBet,
    TradingRound,
    TradingPendingBet,
    ChickenRoadRound,
    ChickenRoad2Round,
    VortexSession,
)

_IST = dt_timezone(timedelta(hours=5, minutes=30))


def _money(v):
    if v is None:
        return Decimal('0')
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def _empty_period():
    return {
        'bets': 0,
        'wagered': Decimal('0'),
        'payout': Decimal('0'),
        'profit': Decimal('0'),
        'players': 0,
    }


def _period_from_agg(agg, bets_key='bets', wager_key='wagered', payout_key='payout', players_key='players'):
    wagered = _money(agg.get(wager_key))
    payout = _money(agg.get(payout_key))
    return {
        'bets': int(agg.get(bets_key) or 0),
        'wagered': wagered,
        'payout': payout,
        'profit': wagered - payout,
        'players': int(agg.get(players_key) or 0),
    }


def _scope_qs(qs, effective_admin, is_super):
    if is_super:
        return qs
    return qs.filter(user__worker=effective_admin)


def parse_ist_date(date_str, end_of_day=False):
    """Parse YYYY-MM-DD as IST day bound, return UTC datetime or None."""
    if not date_str:
        return None
    try:
        d = datetime.strptime(date_str.strip(), '%Y-%m-%d').date()
    except ValueError:
        return None
    t = time.max.replace(microsecond=0) if end_of_day else time.min
    local = datetime.combine(d, t, tzinfo=_IST)
    if end_of_day:
        local = local.replace(microsecond=999999)
    return local.astimezone(dt_timezone.utc)


GAME_CATALOG = [
    {
        'slug': 'dice',
        'name': 'Gundu Ata',
        'icon': '🎲',
        'color': '#667eea',
        'blurb': 'Main Gundu Ata betting rounds',
        'control_url_name': 'dice_control',
        'round_hint': 'Search by username, phone, or round id (e.g. R1785425300)',
        'has_rounds': True,
    },
    {
        'slug': 'roulette',
        'name': 'Roulette',
        'icon': '🎡',
        'color': '#e11d48',
        'blurb': 'European roulette spins',
        'control_url_name': None,
        'round_hint': 'Search by username, phone, or round # (database id)',
        'has_rounds': True,
    },
    {
        'slug': 'trading',
        'name': 'Trading',
        'icon': '📈',
        'color': '#059669',
        'blurb': 'Up / Down trading rounds',
        'control_url_name': None,
        'round_hint': 'Search by username, phone, or shared round number',
        'has_rounds': True,
    },
    {
        'slug': 'chicken-road',
        'name': 'Chicken Road',
        'icon': '🐔',
        'color': '#d97706',
        'blurb': 'Chicken Road (v1) sessions',
        'control_url_name': None,
        'round_hint': 'Search by username, phone, or session UUID',
        'has_rounds': True,
    },
    {
        'slug': 'chicken-road-2',
        'name': 'Chicken Road 2',
        'icon': '🐥',
        'color': '#ea580c',
        'blurb': 'Chicken Road 2 crash sessions',
        'control_url_name': None,
        'round_hint': 'Search by username, phone, or session UUID',
        'has_rounds': True,
    },
    {
        'slug': 'vortex',
        'name': 'Vortex',
        'icon': '🌀',
        'color': '#7c3aed',
        'blurb': 'Vortex ring spins',
        'control_url_name': None,
        'round_hint': 'Search by username or phone (wallet ledger)',
        'has_rounds': False,
    },
]


def get_game_meta(slug):
    for g in GAME_CATALOG:
        if g['slug'] == slug:
            return g
    return None


def _dice_stats(effective_admin, is_super, start, end=None):
    qs = _scope_qs(Bet.objects.all(), effective_admin, is_super)
    if start:
        qs = qs.filter(created_at__gte=start)
    if end:
        qs = qs.filter(created_at__lt=end)
    return _period_from_agg(qs.aggregate(
        bets=Count('id'),
        wagered=Sum('chip_amount'),
        payout=Sum('payout_amount'),
        players=Count('user_id', distinct=True),
    ))


def _roulette_stats(effective_admin, is_super, start, end=None):
    qs = _scope_qs(RouletteRound.objects.all(), effective_admin, is_super)
    if start:
        qs = qs.filter(created_at__gte=start)
    if end:
        qs = qs.filter(created_at__lt=end)
    return _period_from_agg(qs.aggregate(
        bets=Count('id'),
        wagered=Sum('total_stake'),
        payout=Sum('total_payout'),
        players=Count('user_id', distinct=True),
    ))


def _trading_stats(effective_admin, is_super, start, end=None):
    qs = _scope_qs(TradingRound.objects.all(), effective_admin, is_super)
    if start:
        qs = qs.filter(created_at__gte=start)
    if end:
        qs = qs.filter(created_at__lt=end)
    return _period_from_agg(qs.aggregate(
        bets=Count('id'),
        wagered=Sum('stake'),
        payout=Sum('payout'),
        players=Count('user_id', distinct=True),
    ))


def _chicken_stats(model, effective_admin, is_super, start, end=None):
    qs = _scope_qs(model.objects.all(), effective_admin, is_super)
    if start:
        qs = qs.filter(created_at__gte=start)
    if end:
        qs = qs.filter(created_at__lt=end)
    return _period_from_agg(qs.aggregate(
        bets=Count('id'),
        wagered=Sum('bet'),
        payout=Sum('payout'),
        players=Count('user_id', distinct=True),
    ))


def _vortex_stats(effective_admin, is_super, start, end=None):
    qs = Transaction.objects.filter(description__istartswith='Vortex')
    if not is_super:
        qs = qs.filter(user__worker=effective_admin)
    if start:
        qs = qs.filter(created_at__gte=start)
    if end:
        qs = qs.filter(created_at__lt=end)
    bet_qs = qs.filter(transaction_type='BET')
    win_qs = qs.filter(transaction_type='WIN')
    wagered = _money(bet_qs.aggregate(s=Sum('amount'))['s'])
    if wagered < 0:
        wagered = abs(wagered)
    payout = _money(win_qs.aggregate(s=Sum('amount'))['s'])
    if payout < 0:
        payout = abs(payout)
    return {
        'bets': bet_qs.count(),
        'wagered': wagered,
        'payout': payout,
        'profit': wagered - payout,
        'players': qs.values('user_id').distinct().count(),
    }


def _active_count(slug, effective_admin, is_super):
    if slug == 'dice':
        since = timezone.now() - timedelta(minutes=2)
        qs = _scope_qs(Bet.objects.filter(created_at__gte=since), effective_admin, is_super)
        return qs.values('user_id').distinct().count()
    if slug == 'roulette':
        qs = _scope_qs(RoulettePendingBet.objects.all(), effective_admin, is_super)
        return qs.values('user_id').distinct().count()
    if slug == 'trading':
        return _scope_qs(TradingPendingBet.objects.all(), effective_admin, is_super).count()
    if slug == 'chicken-road':
        return _scope_qs(
            ChickenRoadRound.objects.filter(status=ChickenRoadRound.Status.PLAYING),
            effective_admin, is_super,
        ).count()
    if slug == 'chicken-road-2':
        return _scope_qs(
            ChickenRoad2Round.objects.filter(status=ChickenRoad2Round.Status.ACTIVE),
            effective_admin, is_super,
        ).count()
    if slug == 'vortex':
        qs = VortexSession.objects.filter(Q(busy=True) | Q(water__gt=0) | Q(earth__gt=0) | Q(fire__gt=0))
        return _scope_qs(qs, effective_admin, is_super).count()
    return 0


def _stats_for_slug(slug, effective_admin, is_super, start, end=None):
    if slug == 'dice':
        return _dice_stats(effective_admin, is_super, start, end)
    if slug == 'roulette':
        return _roulette_stats(effective_admin, is_super, start, end)
    if slug == 'trading':
        return _trading_stats(effective_admin, is_super, start, end)
    if slug == 'chicken-road':
        return _chicken_stats(ChickenRoadRound, effective_admin, is_super, start, end)
    if slug == 'chicken-road-2':
        return _chicken_stats(ChickenRoad2Round, effective_admin, is_super, start, end)
    if slug == 'vortex':
        return _vortex_stats(effective_admin, is_super, start, end)
    return _empty_period()


def build_games_overview(effective_admin, is_super, today_start, today_end):
    games = []
    for meta in GAME_CATALOG:
        today = _stats_for_slug(meta['slug'], effective_admin, is_super, today_start, today_end)
        active = _active_count(meta['slug'], effective_admin, is_super)
        games.append({**meta, 'today': today, 'active': active})
    return games


def _user_search_q(search):
    if not search:
        return Q()
    s = search.strip()
    return (
        Q(user__username__icontains=s)
        | Q(user__phone_number__icontains=s)
        | Q(user__email__icontains=s)
    )


def _apply_common_filters(qs, effective_admin, is_super, date_from, date_to, search_extra_q=None):
    qs = _scope_qs(qs, effective_admin, is_super)
    if date_from:
        qs = qs.filter(created_at__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__lte=date_to)
    return qs


def _row_base(when, user, round_id, detail, stake, payout, result, result_class='neutral', round_url=None, extra=None):
    phone = getattr(user, 'phone_number', '') or ''
    return {
        'when': when,
        'user': user.username if user else '—',
        'user_id': getattr(user, 'id', None),
        'phone': phone,
        'round_id': round_id or '—',
        'round_url': round_url,
        'detail': detail,
        'stake': stake or 0,
        'payout': payout or 0,
        'profit': (stake or 0) - (payout or 0),
        'result': result,
        'result_class': result_class,
        'extra': extra or '',
    }


def activity_queryset(slug, effective_admin, is_super, search='', date_from=None, date_to=None, result='all', round_q=''):
    """Return a Django queryset ready for pagination (and later row mapping)."""
    search = (search or '').strip()
    round_q = (round_q or '').strip()
    result = (result or 'all').lower()

    if slug == 'dice':
        qs = Bet.objects.select_related('user', 'round').order_by('-created_at')
        qs = _apply_common_filters(qs, effective_admin, is_super, date_from, date_to)
        if search:
            qs = qs.filter(_user_search_q(search) | Q(round__round_id__icontains=search))
        if round_q:
            qs = qs.filter(round__round_id__icontains=round_q)
        if result == 'win':
            qs = qs.filter(is_winner=True)
        elif result == 'lose':
            qs = qs.filter(is_winner=False)
        return qs

    if slug == 'roulette':
        qs = RouletteRound.objects.select_related('user').order_by('-created_at')
        qs = _apply_common_filters(qs, effective_admin, is_super, date_from, date_to)
        if search:
            q = _user_search_q(search)
            if search.isdigit():
                q |= Q(pk=int(search)) | Q(winning_number=int(search))
            qs = qs.filter(q)
        if round_q:
            if round_q.isdigit():
                qs = qs.filter(pk=int(round_q))
            else:
                qs = qs.none()
        if result == 'win':
            qs = qs.filter(total_payout__gt=0)
        elif result == 'lose':
            qs = qs.filter(total_payout=0)
        return qs

    if slug == 'trading':
        qs = TradingRound.objects.select_related('user').order_by('-created_at')
        qs = _apply_common_filters(qs, effective_admin, is_super, date_from, date_to)
        if search:
            q = _user_search_q(search)
            if search.isdigit():
                q |= Q(shared_round=int(search)) | Q(pk=int(search))
            qs = qs.filter(q)
        if round_q:
            if round_q.isdigit():
                qs = qs.filter(Q(shared_round=int(round_q)) | Q(pk=int(round_q)))
            else:
                qs = qs.none()
        if result == 'win':
            qs = qs.filter(payout__gt=0)
        elif result == 'lose':
            qs = qs.filter(payout=0)
        return qs

    if slug == 'chicken-road':
        qs = ChickenRoadRound.objects.select_related('user').order_by('-created_at')
        qs = _apply_common_filters(qs, effective_admin, is_super, date_from, date_to)
        if search:
            q = _user_search_q(search) | Q(status__icontains=search)
            try:
                import uuid as _uuid
                _uuid.UUID(search)
                q |= Q(id=search)
            except (ValueError, TypeError, AttributeError):
                pass
            qs = qs.filter(q)
        if round_q:
            try:
                import uuid as _uuid
                _uuid.UUID(round_q)
                qs = qs.filter(id=round_q)
            except (ValueError, TypeError, AttributeError):
                qs = qs.filter(id__iexact=round_q)
        if result == 'win':
            qs = qs.filter(payout__gt=0)
        elif result == 'lose':
            qs = qs.filter(payout=0)
        return qs

    if slug == 'chicken-road-2':
        qs = ChickenRoad2Round.objects.select_related('user').order_by('-created_at')
        qs = _apply_common_filters(qs, effective_admin, is_super, date_from, date_to)
        if search:
            q = _user_search_q(search) | Q(status__icontains=search)
            try:
                import uuid as _uuid
                _uuid.UUID(search)
                q |= Q(id=search)
            except (ValueError, TypeError, AttributeError):
                pass
            qs = qs.filter(q)
        if round_q:
            try:
                import uuid as _uuid
                _uuid.UUID(round_q)
                qs = qs.filter(id=round_q)
            except (ValueError, TypeError, AttributeError):
                qs = qs.filter(id__iexact=round_q)
        if result == 'win':
            qs = qs.filter(payout__gt=0)
        elif result == 'lose':
            qs = qs.filter(payout=0)
        return qs

    if slug == 'vortex':
        qs = Transaction.objects.filter(description__istartswith='Vortex').select_related('user').order_by('-created_at')
        if not is_super:
            qs = qs.filter(user__worker=effective_admin)
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)
        if search:
            qs = qs.filter(
                Q(user__username__icontains=search)
                | Q(user__phone_number__icontains=search)
                | Q(description__icontains=search)
            )
        if result == 'win':
            qs = qs.filter(transaction_type='WIN')
        elif result == 'lose':
            qs = qs.filter(transaction_type='BET')
        return qs

    return Bet.objects.none()


def map_activity_rows(slug, page_items):
    rows = []
    for obj in page_items:
        if slug == 'dice':
            rid = obj.round.round_id
            try:
                url = reverse('round_details', kwargs={'round_id': rid})
            except Exception:
                url = f'/game-admin/round/{rid}/'
            rows.append(_row_base(
                obj.created_at, obj.user, rid,
                f'Bet on #{obj.number}',
                obj.chip_amount, obj.payout_amount,
                'Win' if obj.is_winner else 'Lose',
                'win' if obj.is_winner else 'lose',
                url,
            ))
        elif slug == 'roulette':
            rid = str(obj.pk)
            url = reverse('admin_game_round', kwargs={'game_slug': 'roulette', 'round_id': rid})
            rows.append(_row_base(
                obj.created_at, obj.user, f'#{rid}',
                f'Landed {obj.winning_number}',
                obj.total_stake, obj.total_payout,
                'Win' if obj.total_payout > 0 else 'Lose',
                'win' if obj.total_payout > 0 else 'lose',
                url,
            ))
        elif slug == 'trading':
            rid = str(obj.shared_round)
            url = reverse('admin_game_round', kwargs={'game_slug': 'trading', 'round_id': rid})
            rows.append(_row_base(
                obj.created_at, obj.user, f'R{rid}',
                f'{(obj.side or "-").upper()} · {obj.final_pct:.2f}%',
                obj.stake, obj.payout,
                'Cashout' if obj.cashed_out else ('Win' if obj.payout > 0 else 'Lose'),
                'win' if obj.payout > 0 else 'lose',
                url,
            ))
        elif slug == 'chicken-road':
            rid = str(obj.id)
            url = reverse('admin_game_round', kwargs={'game_slug': 'chicken-road', 'round_id': rid})
            rows.append(_row_base(
                obj.created_at, obj.user, rid[:8] + '…',
                f'{obj.difficulty} · step {obj.step}',
                obj.bet, obj.payout, obj.status,
                'win' if obj.payout > 0 else 'lose',
                url,
            ))
        elif slug == 'chicken-road-2':
            rid = str(obj.id)
            url = reverse('admin_game_round', kwargs={'game_slug': 'chicken-road-2', 'round_id': rid})
            rows.append(_row_base(
                obj.created_at, obj.user, rid[:8] + '…',
                f'{obj.difficulty} · step {obj.step} · crash@{obj.crash_at}',
                obj.bet, obj.payout, obj.status,
                'win' if obj.payout > 0 else 'lose',
                url,
            ))
        elif slug == 'vortex':
            stake = abs(obj.amount) if obj.transaction_type == 'BET' else 0
            payout = abs(obj.amount) if obj.transaction_type == 'WIN' else 0
            rows.append(_row_base(
                obj.created_at, obj.user, f'TXN {obj.pk}',
                (obj.description or obj.transaction_type)[:90],
                stake, payout, obj.transaction_type,
                'win' if obj.transaction_type == 'WIN' else 'lose',
                None,
            ))
    return rows


def filtered_activity_stats(slug, qs):
    """Aggregate wagered/payout for the current filtered queryset."""
    if slug == 'dice':
        agg = qs.aggregate(bets=Count('id'), wagered=Sum('chip_amount'), payout=Sum('payout_amount'), players=Count('user_id', distinct=True))
        return _period_from_agg(agg)
    if slug == 'roulette':
        agg = qs.aggregate(bets=Count('id'), wagered=Sum('total_stake'), payout=Sum('total_payout'), players=Count('user_id', distinct=True))
        return _period_from_agg(agg)
    if slug == 'trading':
        agg = qs.aggregate(bets=Count('id'), wagered=Sum('stake'), payout=Sum('payout'), players=Count('user_id', distinct=True))
        return _period_from_agg(agg)
    if slug in ('chicken-road', 'chicken-road-2'):
        agg = qs.aggregate(bets=Count('id'), wagered=Sum('bet'), payout=Sum('payout'), players=Count('user_id', distinct=True))
        return _period_from_agg(agg)
    if slug == 'vortex':
        bet_qs = qs.filter(transaction_type='BET')
        win_qs = qs.filter(transaction_type='WIN')
        wagered = abs(_money(bet_qs.aggregate(s=Sum('amount'))['s']))
        payout = abs(_money(win_qs.aggregate(s=Sum('amount'))['s']))
        return {
            'bets': bet_qs.count(),
            'wagered': wagered,
            'payout': payout,
            'profit': wagered - payout,
            'players': qs.values('user_id').distinct().count(),
        }
    return _empty_period()


def build_game_detail(slug, effective_admin, is_super, today_start, today_end, yday_start, yday_end):
    meta = get_game_meta(slug)
    if not meta:
        return None
    return {
        **meta,
        'today': _stats_for_slug(slug, effective_admin, is_super, today_start, today_end),
        'yesterday': _stats_for_slug(slug, effective_admin, is_super, yday_start, yday_end),
        'all_time': _stats_for_slug(slug, effective_admin, is_super, None, None),
        'active': _active_count(slug, effective_admin, is_super),
    }


def lookup_round_detail(slug, round_id, effective_admin, is_super):
    """Return a structured round/session detail dict, or None."""
    round_id = (round_id or '').strip()
    if not round_id:
        return None

    if slug == 'dice':
        try:
            round_obj = GameRound.objects.get(round_id=round_id)
        except GameRound.DoesNotExist:
            # fuzzy
            round_obj = GameRound.objects.filter(round_id__icontains=round_id).order_by('-start_time').first()
            if not round_obj:
                return {'error': f'Round “{round_id}” not found'}
        bets = Bet.objects.filter(round=round_obj).select_related('user').order_by('-created_at')
        bets = _scope_qs(bets, effective_admin, is_super)
        agg = bets.aggregate(c=Count('id'), w=Sum('chip_amount'), p=Sum('payout_amount'), players=Count('user_id', distinct=True))
        return {
            'title': f'Gundu Ata Round {round_obj.round_id}',
            'subtitle': f'Status: {round_obj.status} · Result: {round_obj.dice_result or "—"}',
            'stats': {
                'bets': agg['c'] or 0,
                'wagered': agg['w'] or 0,
                'payout': agg['p'] or 0,
                'players': agg['players'] or 0,
                'profit': (agg['w'] or 0) - (agg['p'] or 0),
            },
            'full_url': reverse('round_details', kwargs={'round_id': round_obj.round_id}),
            'rows': [
                {
                    'when': b.created_at,
                    'user': b.user.username,
                    'user_id': b.user_id,
                    'phone': b.user.phone_number or '',
                    'detail': f'#{b.number}',
                    'stake': b.chip_amount,
                    'payout': b.payout_amount,
                    'result': 'Win' if b.is_winner else 'Lose',
                    'result_class': 'win' if b.is_winner else 'lose',
                }
                for b in bets[:200]
            ],
        }

    if slug == 'roulette':
        try:
            r = RouletteRound.objects.select_related('user').get(pk=int(round_id))
        except (ValueError, RouletteRound.DoesNotExist):
            return {'error': f'Roulette round #{round_id} not found'}
        if not is_super and r.user.worker_id != effective_admin.id:
            return {'error': 'Round not in your franchise'}
        settled = list(RouletteSettledBet.objects.filter(round=r).order_by('id'))
        return {
            'title': f'Roulette Round #{r.pk}',
            'subtitle': f'{r.user.username} · Landed {r.winning_number} · {r.created_at}',
            'stats': {
                'bets': len(settled),
                'wagered': r.total_stake,
                'payout': r.total_payout,
                'players': 1,
                'profit': r.total_stake - r.total_payout,
            },
            'full_url': None,
            'rows': [
                {
                    'when': r.created_at,
                    'user': r.user.username,
                    'user_id': r.user_id,
                    'phone': r.user.phone_number or '',
                    'detail': f'{sb.bet_type}:{sb.bet_value or "-"}',
                    'stake': sb.amount,
                    'payout': sb.payout,
                    'result': 'Win' if sb.won else 'Lose',
                    'result_class': 'win' if sb.won else 'lose',
                }
                for sb in settled
            ] or [{
                'when': r.created_at,
                'user': r.user.username,
                'user_id': r.user_id,
                'phone': r.user.phone_number or '',
                'detail': f'Landed {r.winning_number}',
                'stake': r.total_stake,
                'payout': r.total_payout,
                'result': 'Win' if r.total_payout > 0 else 'Lose',
                'result_class': 'win' if r.total_payout > 0 else 'lose',
            }],
        }

    if slug == 'trading':
        try:
            shared = int(round_id)
        except ValueError:
            return {'error': f'Invalid shared round “{round_id}”'}
        qs = TradingRound.objects.filter(shared_round=shared).select_related('user').order_by('-created_at')
        qs = _scope_qs(qs, effective_admin, is_super)
        if not qs.exists():
            return {'error': f'Trading shared round {shared} not found'}
        agg = qs.aggregate(c=Count('id'), w=Sum('stake'), p=Sum('payout'), players=Count('user_id', distinct=True))
        return {
            'title': f'Trading Shared Round R{shared}',
            'subtitle': f'{agg["c"]} player results',
            'stats': {
                'bets': agg['c'] or 0,
                'wagered': agg['w'] or 0,
                'payout': agg['p'] or 0,
                'players': agg['players'] or 0,
                'profit': (agg['w'] or 0) - (agg['p'] or 0),
            },
            'full_url': None,
            'rows': [
                {
                    'when': t.created_at,
                    'user': t.user.username,
                    'user_id': t.user_id,
                    'phone': t.user.phone_number or '',
                    'detail': f'{(t.side or "-").upper()} · {t.final_pct:.2f}%',
                    'stake': t.stake,
                    'payout': t.payout,
                    'result': 'Cashout' if t.cashed_out else ('Win' if t.payout > 0 else 'Lose'),
                    'result_class': 'win' if t.payout > 0 else 'lose',
                }
                for t in qs[:200]
            ],
        }

    if slug == 'chicken-road':
        r = ChickenRoadRound.objects.select_related('user').filter(id=round_id).first()
        if not r:
            return {'error': f'Session “{round_id}” not found'}
        if not is_super and r.user.worker_id != effective_admin.id:
            return {'error': 'Session not in your franchise'}
        return {
            'title': f'Chicken Road Session',
            'subtitle': f'{r.user.username} · {r.difficulty} · {r.status} · step {r.step}',
            'stats': {
                'bets': 1,
                'wagered': r.bet,
                'payout': r.payout,
                'players': 1,
                'profit': r.bet - r.payout,
            },
            'full_url': None,
            'rows': [{
                'when': r.created_at,
                'user': r.user.username,
                'user_id': r.user_id,
                'phone': r.user.phone_number or '',
                'detail': f'{r.difficulty} · step {r.step} · {r.status}',
                'stake': r.bet,
                'payout': r.payout,
                'result': r.status,
                'result_class': 'win' if r.payout > 0 else 'lose',
            }],
        }

    if slug == 'chicken-road-2':
        r = ChickenRoad2Round.objects.select_related('user').filter(id=round_id).first()
        if not r:
            return {'error': f'Session “{round_id}” not found'}
        if not is_super and r.user.worker_id != effective_admin.id:
            return {'error': 'Session not in your franchise'}
        return {
            'title': f'Chicken Road 2 Session',
            'subtitle': f'{r.user.username} · {r.difficulty} · {r.status} · crash@{r.crash_at}',
            'stats': {
                'bets': 1,
                'wagered': r.bet,
                'payout': r.payout,
                'players': 1,
                'profit': r.bet - r.payout,
            },
            'full_url': None,
            'rows': [{
                'when': r.created_at,
                'user': r.user.username,
                'user_id': r.user_id,
                'phone': r.user.phone_number or '',
                'detail': f'{r.difficulty} · step {r.step} · crash@{r.crash_at} · {r.status}',
                'stake': r.bet,
                'payout': r.payout,
                'result': r.status,
                'result_class': 'win' if r.payout > 0 else 'lose',
            }],
        }

    return {'error': 'Round lookup not available for this game'}


def list_recent_games(slug, effective_admin, is_super, limit=30):
    """
    Recent rounds/sessions for a game — shown on the game detail page.
    Returns list of dicts: round_id, label, when, status, result, bets, wagered, url
    """
    limit = max(1, min(int(limit or 30), 100))
    rows = []

    if slug == 'dice':
        qs = GameRound.objects.annotate(
            round_bets_count=Count('bets'),
            round_bets_amount=Coalesce(Sum('bets__chip_amount'), Value(0)),
        ).order_by('-start_time')[:limit]
        if not is_super:
            # Only rounds that have bets from this franchise tree
            from game.admin_utils import agent_ids_under_admin
            owner_ids = [effective_admin.id] + list(agent_ids_under_admin(effective_admin))
            qs = GameRound.objects.filter(
                bets__user__worker_id__in=owner_ids
            ).annotate(
                round_bets_count=Count('bets', filter=Q(bets__user__worker_id__in=owner_ids)),
                round_bets_amount=Coalesce(
                    Sum('bets__chip_amount', filter=Q(bets__user__worker_id__in=owner_ids)),
                    Value(0),
                ),
            ).order_by('-start_time')[:limit]
        for r in qs:
            rows.append({
                'round_id': r.round_id,
                'label': r.round_id,
                'when': r.start_time,
                'status': r.status,
                'result': r.dice_result or '—',
                'bets': r.round_bets_count or 0,
                'wagered': r.round_bets_amount or 0,
                'url': reverse('round_details', kwargs={'round_id': r.round_id}),
            })
        return rows

    if slug == 'roulette':
        qs = _scope_qs(RouletteRound.objects.select_related('user'), effective_admin, is_super)
        for r in qs.order_by('-created_at')[:limit]:
            rows.append({
                'round_id': str(r.pk),
                'label': f'#{r.pk} · {r.user.username}',
                'when': r.created_at,
                'status': 'SETTLED',
                'result': str(r.winning_number),
                'bets': 1,
                'wagered': r.total_stake,
                'url': reverse('admin_game_round', kwargs={'game_slug': 'roulette', 'round_id': r.pk}),
            })
        return rows

    if slug == 'trading':
        seen = []
        for sid in (
            _scope_qs(TradingRound.objects.all(), effective_admin, is_super)
            .order_by('-created_at')
            .values_list('shared_round', flat=True)[:limit * 4]
        ):
            if sid not in seen:
                seen.append(sid)
            if len(seen) >= limit:
                break
        for sid in seen:
            qs = _scope_qs(
                TradingRound.objects.filter(shared_round=sid), effective_admin, is_super
            )
            agg = qs.aggregate(c=Count('id'), w=Sum('stake'))
            latest = qs.order_by('-created_at').first()
            rows.append({
                'round_id': str(sid),
                'label': f'R{sid}',
                'when': latest.created_at if latest else None,
                'status': 'SETTLED',
                'result': f'{latest.final_pct:.2f}%' if latest else '—',
                'bets': agg['c'] or 0,
                'wagered': agg['w'] or 0,
                'url': reverse('admin_game_round', kwargs={'game_slug': 'trading', 'round_id': sid}),
            })
        return rows

    if slug == 'chicken-road':
        qs = _scope_qs(ChickenRoadRound.objects.select_related('user'), effective_admin, is_super)
        for r in qs.order_by('-created_at')[:limit]:
            rows.append({
                'round_id': str(r.id),
                'label': f'{r.user.username} · {r.difficulty}',
                'when': r.created_at,
                'status': r.status,
                'result': f'step {r.step}',
                'bets': 1,
                'wagered': r.bet,
                'url': reverse('admin_game_round', kwargs={'game_slug': 'chicken-road', 'round_id': r.id}),
            })
        return rows

    if slug == 'chicken-road-2':
        qs = _scope_qs(ChickenRoad2Round.objects.select_related('user'), effective_admin, is_super)
        for r in qs.order_by('-created_at')[:limit]:
            rows.append({
                'round_id': str(r.id),
                'label': f'{r.user.username} · {r.difficulty}',
                'when': r.created_at,
                'status': r.status,
                'result': f'crash@{r.crash_at}',
                'bets': 1,
                'wagered': r.bet,
                'url': reverse('admin_game_round', kwargs={'game_slug': 'chicken-road-2', 'round_id': r.id}),
            })
        return rows

    if slug == 'vortex':
        # No round table — show recent vortex wallet txs as "recent games"
        qs = Transaction.objects.filter(
            Q(description__icontains='vortex') | Q(transaction_type__icontains='VORTEX')
        ).select_related('user').order_by('-created_at')
        if not is_super:
            qs = qs.filter(user__worker=effective_admin)
        for t in qs[:limit]:
            rows.append({
                'round_id': str(t.id),
                'label': t.user.username,
                'when': t.created_at,
                'status': t.transaction_type,
                'result': (t.description or '')[:40],
                'bets': 1,
                'wagered': abs(t.amount or 0),
                'url': reverse('user_details', kwargs={'user_id': t.user_id}),
            })
        return rows

    return rows


def _owner_ids_for_actor(actor):
    """None = Super Admin (unscoped). Else worker PKs whose players are visible."""
    from .admin_utils import is_super_admin, is_franchise_admin, is_agent, agent_ids_under_admin

    if not actor:
        return []
    if is_super_admin(actor):
        return None
    if is_franchise_admin(actor):
        return [actor.id] + list(agent_ids_under_admin(actor))
    if is_agent(actor):
        return [actor.id]
    return []


def _apply_owner_ids(qs, owner_ids):
    if owner_ids is None:
        return qs
    if not owner_ids:
        return qs.none()
    return qs.filter(user__worker_id__in=owner_ids)


def build_owner_filter_options(actor):
    """
    Dropdown choices for filtering All Bets by Admin only (no Agents).
    Returns list of {id, label} where id '' means all in scope.
    """
    from accounts.models import User
    from .admin_utils import is_super_admin, is_franchise_admin, is_agent

    options = [{'id': '', 'label': 'All Admins'}]
    if not actor:
        return options

    if is_super_admin(actor):
        for a in User.objects.filter(is_staff=True, is_active=True).filter(
            Q(staff_role=User.ROLE_ADMIN) | Q(is_franchise_only=True)
        ).exclude(is_superuser=True).exclude(staff_role=User.ROLE_AGENT).order_by('username'):
            options.append({'id': str(a.id), 'label': f'Admin: {a.username}'})
        return options

    if is_franchise_admin(actor):
        # Franchise Admin only sees their own tree; keep a clear self option
        options.append({'id': str(actor.id), 'label': f'Me (Admin: {actor.username})'})
        return options

    if is_agent(actor):
        # Agents no longer filter All Bets by owner — they only see their own scope
        return [{'id': '', 'label': 'My users'}]

    return options


def resolve_owner_filter(actor, owner_param):
    """
    Intersect actor's allowed scope with optional Admin filter.
    owner_param: '' / 'all' / '<admin_pk>'
    Selecting an Admin → that Admin + Agents under them (full tree).
    Agents are not offered as filter options.
    """
    from accounts.models import User
    from .admin_utils import is_franchise_admin, agent_ids_under_admin

    allowed = _owner_ids_for_actor(actor)
    raw = (owner_param or '').strip()
    if not raw or raw.lower() == 'all':
        return allowed

    # Legacy prefixes still accepted but treated as admin tree / direct
    if raw.startswith('direct:'):
        try:
            owner_pk = int(raw.split(':', 1)[1])
        except (TypeError, ValueError):
            return allowed if allowed is not None else []
        if allowed is not None and owner_pk not in set(allowed) and owner_pk != getattr(actor, 'id', None):
            return allowed
        return [owner_pk]

    if raw.startswith('tree:'):
        raw = raw.split(':', 1)[1]

    try:
        owner_pk = int(raw)
    except (TypeError, ValueError):
        return allowed if allowed is not None else []

    # Security: only allow owners inside actor scope (Super Admin has allowed=None)
    if allowed is not None and owner_pk not in set(allowed) and owner_pk != getattr(actor, 'id', None):
        return allowed

    owner = User.objects.filter(pk=owner_pk).first()
    if not owner:
        return allowed if allowed is not None else []

    # Only Admins are valid filter targets — expand to Admin + their Agents
    if is_franchise_admin(owner) or getattr(owner, 'is_franchise_only', False):
        tree_ids = [owner.id] + list(agent_ids_under_admin(owner))
        if allowed is None:
            return tree_ids
        allowed_set = set(allowed)
        return [i for i in tree_ids if i in allowed_set]

    # Non-admin selected (shouldn't appear in UI) — ignore and keep scope
    return allowed if allowed is not None else []


def build_all_games_bets(
    actor,
    search='',
    status='all',
    game_slug='all',
    owner_param='',
    limit=200,
    per_game_fetch=250,
):
    """
    Unified bet feed across every game in GAME_CATALOG.
    Returns (rows, totals_dict, game_options, owner_options).
    """
    search = (search or '').strip()
    status = (status or 'all').lower()
    game_slug = (game_slug or 'all').strip().lower()
    if status in ('winners', 'win'):
        result_filter = 'win'
    elif status in ('losers', 'lose'):
        result_filter = 'lose'
    else:
        result_filter = 'all'

    owner_ids = resolve_owner_filter(actor, owner_param)
    owner_options = build_owner_filter_options(actor)
    # Skip activity_queryset's internal franchise-only scope; apply tree scope ourselves.
    is_super_for_qs = True

    if game_slug and game_slug != 'all':
        catalogs = [g for g in GAME_CATALOG if g['slug'] == game_slug]
    else:
        catalogs = list(GAME_CATALOG)

    game_options = [{'slug': 'all', 'name': 'All games', 'icon': '🎮'}] + [
        {'slug': g['slug'], 'name': g['name'], 'icon': g['icon']} for g in GAME_CATALOG
    ]

    rows = []
    totals = {
        'total_bets_count': 0,
        'total_bets_amount': Decimal('0'),
        'total_payouts': Decimal('0'),
        'total_winners': 0,
    }

    for meta in catalogs:
        slug = meta['slug']
        try:
            qs = activity_queryset(
                slug,
                actor,
                is_super_for_qs,
                search=search,
                result=result_filter,
            )
            qs = _apply_owner_ids(qs, owner_ids)
            stats = filtered_activity_stats(slug, qs)
            totals['total_bets_count'] += int(stats.get('bets') or 0)
            totals['total_bets_amount'] += _money(stats.get('wagered'))
            totals['total_payouts'] += _money(stats.get('payout'))

            # Winners count (best-effort per game model)
            if slug == 'dice':
                totals['total_winners'] += qs.filter(is_winner=True).count()
            elif slug == 'roulette':
                totals['total_winners'] += qs.filter(total_payout__gt=0).count()
            elif slug in ('trading', 'chicken-road', 'chicken-road-2'):
                totals['total_winners'] += qs.filter(payout__gt=0).count()
            elif slug == 'vortex':
                totals['total_winners'] += qs.filter(transaction_type='WIN').count()

            try:
                page_items = list(qs.select_related('user', 'user__worker')[:per_game_fetch])
            except Exception:
                page_items = list(qs[:per_game_fetch])
            mapped = map_activity_rows(slug, page_items)
            # Attach owner (assigned Admin/Agent) for display
            owner_by_user = {}
            for obj in page_items:
                u = getattr(obj, 'user', None)
                if u and u.id not in owner_by_user:
                    w = getattr(u, 'worker', None)
                    owner_by_user[u.id] = w.username if w else '—'
            for row in mapped:
                row['game_slug'] = slug
                row['game_name'] = meta['name']
                row['game_icon'] = meta['icon']
                row['game_color'] = meta['color']
                row['owner'] = owner_by_user.get(row.get('user_id'), '—')
                rows.append(row)
        except Exception:
            # One broken game source should not blank the whole All Bets page
            continue

    rows.sort(key=lambda r: r.get('when') or timezone.now(), reverse=True)
    rows = rows[:limit]
    return rows, totals, game_options, owner_options
