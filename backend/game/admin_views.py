from django.shortcuts import render, redirect, get_object_or_404
from django.contrib import messages
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.contrib.sessions.models import Session
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt
from django.views.decorators.http import require_POST
from django.utils import timezone
from django.conf import settings
from django.http import JsonResponse
from django.db import transaction as db_transaction
import redis
import json
import os
from collections import Counter
from .models import GameRound, Bet, DiceResult, GameSettings, AdminPermissions, WhiteLabelLead
from accounts.models import Wallet, Transaction, DepositRequest, WithdrawRequest, User, PaymentMethod, FranchiseBalance, FranchiseBalanceLog, AutoDepositTransaction
from accounts.player_distribution import (
    redistribute_all_players,
    balance_player_distribution,
    get_admins_for_distribution
)
from django.db.models import Count, Sum, Q, F, Value
from django.db.models.functions import Coalesce
try:
    from accounts.models import AdminProfile
except ImportError:
    AdminProfile = None
from .views import get_dice_mode, set_dice_mode
from .admin_utils import (
    is_super_admin, is_admin, is_franchise_admin, is_agent,
    has_permission, get_admin_profile,
    super_admin_required, admin_required, franchise_admin_required, permission_required,
    get_admin_permissions, has_menu_permission, invalidate_admin_permissions_cache,
    get_effective_admin, get_franchise_admin, get_scoped_player_qs, agent_ids_under_admin,
    cap_permissions, apply_permissions_to_user, permissions_dict_from_post,
    sync_staff_flags, PERMISSION_FIELD_NAMES, build_permission_checklist_items,
    is_god, role_of, hide_god_from,
    sees_all_data, staff_subtree_ids, visible_staff_qs,
)
from .utils import get_game_setting, clear_game_setting_cache
from .load_test_utils import load_tester
from decimal import Decimal, InvalidOperation
import decimal
from django.core.paginator import Paginator
from django.core.cache import cache
import logging

logger = logging.getLogger(__name__)

# Dashboard "daily" metrics are requested in IST (business day).
# We keep project TIME_ZONE=UTC, so compute IST day bounds and convert to UTC for DB filtering.
import datetime as _dt
_IST_TZ = _dt.timezone(_dt.timedelta(hours=5, minutes=30))


def _ist_day_bounds_utc(day_offset: int = 0):
    """
    Return (start_utc, end_utc, ist_date) for IST day `today + day_offset`.
    Uses a fixed +05:30 offset (no DST in IST).
    """
    now_ist = timezone.now().astimezone(_IST_TZ)
    ist_date = now_ist.date() + _dt.timedelta(days=day_offset)
    start_ist = _dt.datetime.combine(ist_date, _dt.time.min, tzinfo=_IST_TZ)
    end_ist = start_ist + _dt.timedelta(days=1)
    return start_ist.astimezone(_dt.timezone.utc), end_ist.astimezone(_dt.timezone.utc), ist_date


# Cache TTLs for admin dashboard (reduce DB load and avoid 504 timeouts)
ADMIN_DASHBOARD_STATS_CACHE_KEY = 'admin_dashboard_bet_stats'
ADMIN_DASHBOARD_STATS_TTL = 300  # 5 min - heavy Bet aggregate runs at most once per 5 min
ADMIN_DASHBOARD_DATA_CACHE_KEY = 'admin_dashboard_data_json'
ADMIN_DASHBOARD_DATA_TTL = 20   # seconds - dashboard-data returns cache more often
# Dashboard shows daily overview only (today's stats)
ADMIN_DASHBOARD_STATS_DAYS = 1

# Redis connection using connection pool (optimized for scalability)
from .utils import get_redis_client

# Redis connection with tiered failover
redis_client = get_redis_client()


def _owner_ids_for_scope(actor):
    """None = God (no filter). Else player-owner PKs in the actor's own subtree."""
    if sees_all_data(actor):
        return None
    return staff_subtree_ids(actor)


def _scope_by_owner(qs, actor, field='user__worker'):
    """Filter qs to players in actor's Super/Admin/Agent tree."""
    ids = _owner_ids_for_scope(actor)
    if ids is None:
        return qs
    if not ids:
        return qs.none()
    return qs.filter(**{f'{field}__in': ids})


def _can_act_on_player(actor, player):
    """
    True when `player` sits inside `actor`'s subtree, i.e. the actor may approve,
    reject, or edit that player's requests. God may act on anyone.
    """
    if sees_all_data(actor):
        return True
    owner_id = getattr(player, 'worker_id', None)
    if owner_id is None:
        return False
    return owner_id in set(staff_subtree_ids(actor))


def _deduct_franchise_for_actor(actor, amount_int):
    """
    Deduct franchise balance from franchise Admin (not Agent).
    Returns (ok, error_message). Super Admin skips deduction.
    """
    if is_super_admin(actor):
        return True, None
    fa = get_franchise_admin(actor) or actor
    if is_super_admin(fa):
        return True, None
    fb, _ = FranchiseBalance.objects.get_or_create(user=fa, defaults={'balance': 0})
    fb = FranchiseBalance.objects.select_for_update().get(pk=fb.pk)
    if fb.balance < amount_int:
        return False, (
            f'Insufficient franchise balance. Admin balance: ₹{fb.balance}, '
            f'required: ₹{amount_int}. Contact super admin for top-up.'
        )
    FranchiseBalance.objects.filter(pk=fb.pk).update(balance=F('balance') - amount_int)
    return True, None


def get_admin_context(request, extra_context=None):
    """Helper function to get common admin context for all admin pages"""
    admin_permissions = get_admin_permissions(request.user)
    # For super admins, create a dummy object with all permissions set to True for template
    if is_super_admin(request.user) and admin_permissions is None:
        class DummyPermissions:
            can_view_dashboard = True
            can_control_dice = True
            can_view_recent_rounds = True
            can_view_all_bets = True
            can_view_wallets = True
            can_view_players = True
            can_view_deposit_requests = True
            can_view_withdraw_requests = True
            can_view_transactions = True
            can_view_game_history = True
            can_view_game_settings = True
            can_view_admin_management = True
            can_view_help_center = True
            can_view_white_label = True
            can_manage_payment_methods = True
        admin_permissions = DummyPermissions()
    
    context = {
        'admin_permissions': admin_permissions,
        'is_super_admin': is_super_admin(request.user),
        'is_franchise_admin': is_franchise_admin(request.user),
        'is_agent': is_agent(request.user),
        'user': request.user,
        'user_works_under_id': getattr(request.user, 'works_under_id', None) or '',
        'admin_referral_code': getattr(request.user, 'referral_code', None) or '',
    }
    
    if extra_context:
        context.update(extra_context)
    
    return context

@ensure_csrf_cookie
@csrf_exempt
def admin_login(request):
    """Custom login page for game admin panel - SECURITY: Rate limited"""
    if request.user.is_authenticated and is_admin(request.user):
        # Already logged in and is admin, redirect to dashboard
        next_url = request.GET.get('next', '/game-admin/dashboard/')
        return redirect(next_url)
    
    # SECURITY: Rate limiting to prevent brute force attacks
    from django.core.cache import cache
    from django.conf import settings
    
    # Get client IP address
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if x_forwarded_for:
        client_ip = x_forwarded_for.split(',')[0].strip()
    else:
        client_ip = request.META.get('REMOTE_ADDR', '')
    
    cache_key = f'login_attempts_{client_ip}'
    failed_logins_key = f'failed_logins_{client_ip}'
    
    # Check rate limit: max 5 attempts per 15 minutes (short-term protection)
    login_attempts = cache.get(cache_key, 0)
    if login_attempts >= 5:
        error_message = 'Too many login attempts. Please try again in 15 minutes.'
        context = {
            'next': request.GET.get('next', '/game-admin/dashboard/'),
            'error_message': error_message,
        }
        return render(request, 'admin/login.html', context)
    
    # Check brute force protection: 50 failed attempts = 2 hour ban (configurable)
    import os
    brute_force_threshold = int(os.getenv('BRUTE_FORCE_THRESHOLD', '50'))
    brute_force_ban_time = int(os.getenv('BRUTE_FORCE_BAN_TIME', '7200'))
    
    failed_logins = cache.get(failed_logins_key, 0)
    if failed_logins >= brute_force_threshold:
        ban_hours = brute_force_ban_time // 3600
        error_message = f'Too many failed login attempts. Your IP has been blocked for {ban_hours} hours.'
        context = {
            'next': request.GET.get('next', '/game-admin/dashboard/'),
            'error_message': error_message,
        }
        return render(request, 'admin/login.html', context)
    
    error_message = None
    if request.method == 'POST':
        username = (request.POST.get('username') or '').strip()
        password = (request.POST.get('password') or '').strip()
        next_url = request.POST.get('next', '/game-admin/dashboard/')
        
        if username and password:
            from django.contrib.auth import authenticate, login
            user = authenticate(request, username=username, password=password)
            # If exact username failed, try case-insensitive lookup (e.g. "Sai" vs "sai")
            if user is None and username:
                try:
                    u = User.objects.get(username__iexact=username)
                    if u.check_password(password):
                        user = u
                except User.DoesNotExist:
                    pass
            if user is not None:
                if not user.is_active:
                    error_message = 'This account is deactivated. Contact an administrator.'
                elif is_admin(user):
                    # Successful login - reset all attempt counters
                    cache.delete(cache_key)
                    cache.delete(failed_logins_key)
                    login(request, user)
                    request.session.save()
                    messages.success(request, f'Welcome, {user.username}!')
                    # Advisory only — never allowed to affect the login outcome
                    try:
                        from .telegram_utils import notify_login
                        notify_login(user, request, ROLE_DISPLAY.get(role_of(user), ('Staff', ''))[0])
                    except Exception as e:
                        logger.warning('telegram login alert failed: %s', e)
                    # Render dashboard in same request so session cookie is in this response (avoids redirect cookie loss)
                    try:
                        return admin_dashboard(request)
                    except Exception as e:
                        logger.exception('admin_dashboard after login: %s', e)
                        # Fallback: redirect so user still gets session cookie; next request may succeed
                        return redirect('/game-admin/dashboard/')
                else:
                    error_message = 'You do not have permission to access the admin panel.'
                    # Increment failed attempt counter
                    login_attempts = cache.get(cache_key, 0) + 1
                    cache.set(cache_key, login_attempts, 900)  # 15 minutes
                    # Track failed logins for firewall middleware
                    failed_count = cache.get(failed_logins_key, 0) + 1
                    cache.set(failed_logins_key, failed_count, 900)  # 15 minutes
                    
                    # SECURITY: If too many failed attempts, permanently block IP
                    if failed_count >= brute_force_threshold:
                        from dice_game.attack_detection import AttackDetector
                        AttackDetector.block_ip_permanently(client_ip)
                        error_message = 'Too many failed login attempts. Your IP has been permanently blocked.'
            else:
                error_message = 'Invalid username or password.'
                # Increment failed attempt counter
                login_attempts = cache.get(cache_key, 0) + 1
                cache.set(cache_key, login_attempts, 900)  # 15 minutes
                # Track failed logins for firewall middleware
                failed_count = cache.get(failed_logins_key, 0) + 1
                cache.set(failed_logins_key, failed_count, 900)  # 15 minutes
                
                # SECURITY: If too many failed attempts, permanently block IP
                if failed_count >= brute_force_threshold:
                    from dice_game.attack_detection import AttackDetector
                    AttackDetector.block_ip_permanently(client_ip)
                    error_message = 'Too many failed login attempts. Your IP has been permanently blocked.'
        else:
            error_message = 'Please provide both username and password.'
    
    context = {
        'next': request.GET.get('next', '/game-admin/dashboard/'),
        'error_message': error_message,
    }
    return render(request, 'admin/login.html', context)


def admin_logout(request):
    """Logout view for game admin panel"""
    logout(request)
    messages.success(request, 'You have been successfully logged out.')
    return redirect('admin_login')


@login_required(login_url='/game-admin/login/')
@admin_required
def admin_dashboard(request):
    """Hierarchy snapshot dashboard: big counts for your tree + one action each."""
    if not has_menu_permission(request.user, 'dashboard'):
        if has_menu_permission(request.user, 'deposit_requests'):
            return redirect('deposit_requests')
        elif has_menu_permission(request.user, 'withdraw_requests'):
            return redirect('withdraw_requests')
        elif has_menu_permission(request.user, 'players'):
            return redirect('manage_players')
        elif has_menu_permission(request.user, 'wallets'):
            return redirect('wallets')
        elif has_menu_permission(request.user, 'games') or has_menu_permission(request.user, 'recent_rounds'):
            return redirect('admin_games')
        messages.error(request, 'You do not have permission to view the dashboard.')
        return redirect('admin_login')

    from django.urls import reverse
    from .utils import format_indian_int

    actor = request.user
    snapshot_cards = []

    def _card(label, value, button_label, url_name, accent='#0f172a', value_prefix=''):
        try:
            url = reverse(url_name)
        except Exception:
            url = '#'
        snapshot_cards.append({
            'label': label,
            'value': value,
            'value_display': f'{value_prefix}{value}' if value_prefix else str(value),
            'button_label': button_label,
            'url': url,
            'accent': accent,
        })

    if is_super_admin(actor):
        actor_is_god = is_god(actor)
        role_label = 'God Admin' if actor_is_god else 'Super Admin'
        role_blurb = 'Your platform tree at a glance.'
        # Counts cover the actor's own subtree; only God spans the whole platform.
        subtree = visible_staff_qs(actor).exclude(id=actor.id)
        super_admins_count = subtree.filter(staff_role=User.ROLE_SUPER_ADMIN).count()
        admins_count = subtree.filter(
            Q(staff_role=User.ROLE_ADMIN) | Q(is_franchise_only=True)
        ).exclude(is_superuser=True).exclude(staff_role=User.ROLE_AGENT).count()
        agents_count = subtree.filter(
            Q(staff_role=User.ROLE_AGENT) | Q(works_under__isnull=False, is_franchise_only=False, is_superuser=False)
        ).exclude(staff_role=User.ROLE_ADMIN).exclude(is_superuser=True).count()
        players_count = get_scoped_player_qs(actor).count()
        if actor_is_god:
            _card('Super Admins', super_admins_count, 'View Super Admins', 'franchise_balance', '#7c3aed')
        _card('Admins', admins_count, 'View Admins', 'franchise_balance', '#0d9488')
        _card('Agents', agents_count, 'View Agents', 'agent_management', '#d97706')
        _card('Players', players_count, 'All Users', 'manage_players', '#2563eb')

    elif is_franchise_admin(actor):
        role_label = 'Admin'
        role_blurb = 'Your Agents and users in your tree.'
        agent_ids = list(
            User.objects.filter(is_staff=True, works_under=actor, is_superuser=False)
            .exclude(staff_role=User.ROLE_ADMIN)
            .values_list('id', flat=True)
        )
        agents_count = len(agent_ids)
        tree_players = User.objects.filter(
            worker_id__in=[actor.id] + agent_ids, is_staff=False
        ).count()
        try:
            fb_balance = FranchiseBalance.objects.get(user=actor).balance
        except FranchiseBalance.DoesNotExist:
            fb_balance = 0
        _card('My Agents', agents_count, 'View Agents', 'agent_management', '#d97706')
        _card('Users in tree', tree_players, 'All Users', 'manage_players', '#2563eb')
        snapshot_cards.append({
            'label': 'Franchise balance',
            'value': fb_balance,
            'value_display': f'₹{format_indian_int(fb_balance)}',
            'button_label': 'View Agents',
            'url': reverse('agent_management'),
            'accent': '#0d9488',
        })

    elif is_agent(actor):
        role_label = 'Agent'
        role_blurb = 'Your players and pending queues.'
        my_users = User.objects.filter(worker=actor, is_staff=False).count()
        _card('My users', my_users, 'All Users', 'manage_players', '#2563eb')
        if has_menu_permission(actor, 'deposit_requests'):
            pending_deposits = _scope_by_owner(
                DepositRequest.objects.filter(status='PENDING'), actor, 'user__worker'
            ).count()
            _card('Pending deposits', pending_deposits, 'Open Deposits', 'deposit_requests', '#059669')
        if has_menu_permission(actor, 'withdraw_requests'):
            pending_withdraws = _scope_by_owner(
                WithdrawRequest.objects.filter(status='PENDING'), actor, 'user__worker'
            ).count()
            _card('Pending withdrawals', pending_withdraws, 'Open Withdrawals', 'withdraw_requests', '#dc2626')
    else:
        role_label = 'Staff'
        role_blurb = 'Your hierarchy snapshot.'
        players_count = get_scoped_player_qs(actor).count()
        _card('Players', players_count, 'All Users', 'manage_players', '#2563eb')

    context = get_admin_context(request, {
        'page': 'dashboard',
        'role_label': role_label,
        'role_blurb': role_blurb,
        'snapshot_cards': snapshot_cards,
        'staff_roster': _build_staff_roster(actor),
    })
    return render(request, 'admin/game_dashboard.html', context)


ROLE_DISPLAY = {
    'GOD': ('God Admin', '#7c3aed'),
    'SUPER_ADMIN': ('Super Admin', '#4f46e5'),
    'ADMIN': ('Admin', '#0d9488'),
    'AGENT': ('Agent', '#d97706'),
}


def _build_staff_roster(actor):
    """
    Staff accounts visible to `actor`, ordered God → Super Admin → Admin → Agent.
    God sees every staff account; everyone else sees only their own subtree.
    Agents get no roster.
    """
    if not (is_super_admin(actor) or is_franchise_admin(actor)):
        return []

    staff = visible_staff_qs(actor).select_related('works_under').order_by('username')

    # Player counts per owner in one query instead of per row
    player_counts = dict(
        get_scoped_player_qs(actor)
        .filter(worker__isnull=False)
        .values_list('worker_id')
        .annotate(c=Count('id'))
    )

    actor_is_god = is_god(actor)
    rows = []
    for user in staff:
        role = role_of(user)
        label, colour = ROLE_DISPLAY.get(role, ('Staff', '#64748b'))
        parent = user.works_under
        # Never reveal the God account's username to anyone else
        if parent is None:
            parent_label = '—'
        elif role_of(parent) == 'GOD' and not actor_is_god:
            parent_label = '—'
        else:
            parent_label = parent.username
        rows.append({
            'username': user.username,
            'role': role,
            'role_label': label,
            'role_colour': colour,
            'parent': parent_label,
            'players': player_counts.get(user.id, 0),
            'is_active': user.is_active,
            'last_login': user.last_login,
        })

    rank = User.ROLE_RANK
    rows.sort(key=lambda r: (rank.get(r['role'], 99), r['username'].lower()))
    return rows

@admin_required
def set_dice_result_view(request):
    """Admin view to set dice result (1-6)"""
    if not request.session.get('dice_control_verified'):
        messages.error(request, 'Please verify your PIN first.')
        return redirect('dice_control')

    if request.method == 'POST':
        try:
            # Get current round state using helper
            from .utils import get_current_round_state, get_game_setting
            
            # Enforce local fallback for redis_client if global is missing/None
            local_redis = None
            try:
                 local_redis = redis_client
            except NameError:
                 pass
                 
            round_obj, timer, status, _ = get_current_round_state(local_redis)

            # Get dice result time (needed for restriction check and finalization logic)
            dice_result_time = get_game_setting('DICE_RESULT_TIME', 51)
            
            # Check timer: Cannot set result after dice_result_time (51s)
            if timer >= dice_result_time:
                messages.error(request, f'Cannot set dice result after {dice_result_time} seconds. Use Manual Adjust mode to override.')
                return redirect('dice_control')

            if not round_obj:
                messages.error(request, 'No active round')
                return redirect('dice_control')
            
            dice_result = request.POST.get('result')
            if dice_result:
                try:
                    result_value = int(dice_result)
                    if not (1 <= result_value <= 6):
                        messages.error(request, 'Dice result must be between 1 and 6')
                        return redirect('dice_control')
                except ValueError:
                    messages.error(request, 'Invalid dice result value')
                    return redirect('dice_control')

                # Set result on round object
                round_obj.dice_result = str(result_value)
                # For compatibility, set all dice to this value (simplified legacy behavior)
                for i in range(1, 7):
                    setattr(round_obj, f'dice_{i}', result_value)
                
                # Only finalize the round (status, payouts, broadcast) if we are at or past result time
                should_finalize = timer >= dice_result_time
                
                if should_finalize:
                    round_obj.status = 'RESULT'
                    if not round_obj.result_time:
                        round_obj.result_time = timezone.now()
                
                round_obj.save()
                
                # Create or update dice result record
                DiceResult.objects.update_or_create(
                    round=round_obj,
                    defaults={
                        'result': str(result_value),
                        'set_by': request.user
                    }
                )
                
                # Update Redis
                if local_redis:
                    try:
                        # 1. Update legacy current_round key
                        round_data = local_redis.get('current_round')
                        if round_data:
                            round_data = json.loads(round_data)
                            round_data['dice_result'] = str(result_value)
                            # Update all dice values
                            for i in range(1, 7):
                                round_data[f'dice_{i}'] = result_value
                            
                            if should_finalize:
                                round_data['status'] = 'RESULT'
                            
                            local_redis.set('current_round', json.dumps(round_data))
                        
                        # 2. Update manual_dice_result for the engine to pick up
                        # Format: "1,1,1,1,1,1"
                        manual_dice_str = ",".join([str(result_value)] * 6)
                        local_redis.set("manual_dice_result", manual_dice_str, ex=300)
                    except Exception:
                        pass
                
                # ONLY calculate payouts and broadcast if finalizing
                if should_finalize:
                    # Calculate payouts
                    from .views import calculate_payouts
                    # Legacy mode: all dice same
                    dice_values = [result_value] * 6
                    calculate_payouts(round_obj, dice_result=str(result_value), dice_values=dice_values)
                    
                    # Broadcast to WebSocket
                    from channels.layers import get_channel_layer
                    from asgiref.sync import async_to_sync
                    channel_layer = get_channel_layer()
                    if channel_layer:
                        try:
                            async_to_sync(channel_layer.group_send)(
                                'game_room',
                                {
                                    'type': 'dice_result',
                                    'result': str(result_value),
                                    'dice_values': dice_values,
                                    'round_id': round_obj.round_id,
                                }
                            )
                        except Exception:
                            pass
                
                mode_text = " (Pre-set)" if not should_finalize else ""
                messages.success(request, f'Dice result set{mode_text}: {result_value}')
            else:
                messages.error(request, 'Dice result is required')

        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            from django.http import HttpResponse
            return HttpResponse(f"<html><body><h1>Error setting dice result</h1><pre>{error_trace}</pre><br><a href='/game-admin/dice-control/'>Back to Dice Control</a></body></html>")
            
    referer = request.META.get('HTTP_REFERER', '')
    if 'dice-control' in referer:
        return redirect('dice_control')
    return redirect('admin_dashboard')

@admin_required
def toggle_dice_mode(request):
    """Toggle dice mode between manual and random"""
    if not request.session.get('dice_control_verified'):
        messages.error(request, 'Please verify your PIN first.')
        return redirect('dice_control')

    if request.method == 'POST':
        current_mode = get_dice_mode()
        new_mode = 'manual' if current_mode == 'random' else 'random'
        set_dice_mode(new_mode)
        messages.success(request, f'Dice mode changed to {new_mode}')
    referer = request.META.get('HTTP_REFERER', '')
    if 'dice-control' in referer:
        return redirect('dice_control')
    return redirect('admin_dashboard')

@admin_required
def admin_dashboard_data(request):
    """API endpoint to get admin dashboard data. Franchise owners see only their players' stats."""
    from django.http import HttpResponse
    effective_admin = get_effective_admin(request.user)
    # Only God uses the shared platform-wide cache; everyone else gets fresh scoped data
    cached = None
    if sees_all_data(effective_admin):
        cached = cache.get(ADMIN_DASHBOARD_DATA_CACHE_KEY)
    if cached is not None:
        return HttpResponse(cached, content_type='application/json')

    def _scope_bet(qs):
        return _scope_by_owner(qs, request.user, "user__worker")
    def _scope_txn(qs):
        return _scope_by_owner(qs, request.user, "user__worker")
    def _scope_user(qs):
        return _scope_by_owner(qs, request.user, "worker")

    # Get current round state using helper (fast: Redis + one GameRound lookup)
    from .utils import get_current_round_state
    try:
        current_round, timer, status, _ = get_current_round_state(redis_client)
    except Exception as e:
        logger.warning('admin_dashboard_data get_current_round_state: %s', e)
        current_round, timer, status = None, 0, 'WAITING'

    # Overall stats: franchise-scoped when not super admin
    from django.utils import timezone
    from datetime import timedelta
    cutoff = timezone.now() - timedelta(days=ADMIN_DASHBOARD_STATS_DAYS)
    bet_base = Bet.objects.filter(created_at__gte=cutoff)
    if sees_all_data(effective_admin):
        bet_stats = cache.get(ADMIN_DASHBOARD_STATS_CACHE_KEY)
        if bet_stats is None:
            bet_stats = bet_base.aggregate(total_bets=Count('id'), total_amount=Sum('chip_amount'), total_payout=Sum('payout_amount'))
            try:
                cache.set(ADMIN_DASHBOARD_STATS_CACHE_KEY, bet_stats, ADMIN_DASHBOARD_STATS_TTL)
            except Exception:
                pass
    else:
        bet_stats = _scope_bet(bet_base).aggregate(total_bets=Count('id'), total_amount=Sum('chip_amount'), total_payout=Sum('payout_amount'))
    overall_total_amount = bet_stats.get('total_amount') or 0
    overall_total_payout = bet_stats.get('total_payout') or 0
    overall_total_profit = (overall_total_amount or 0) - (overall_total_payout or 0)
    total_bets_count = bet_stats.get('total_bets') or 0

    # Daily data (IST)
    today_start_utc, today_end_utc, today_ist_date = _ist_day_bounds_utc(0)
    yday_start_utc, yday_end_utc, yday_ist_date = _ist_day_bounds_utc(-1)

    today_bet_agg = _scope_bet(Bet.objects.filter(created_at__gte=today_start_utc, created_at__lt=today_end_utc)).aggregate(
        bets_count=Count('id'), bets_amount=Sum('chip_amount'), payout_amount=Sum('payout_amount'),
    )
    yday_bet_agg = _scope_bet(Bet.objects.filter(created_at__gte=yday_start_utc, created_at__lt=yday_end_utc)).aggregate(
        bets_count=Count('id'), bets_amount=Sum('chip_amount'), payout_amount=Sum('payout_amount'),
    )
    today_deposit_agg = _scope_txn(Transaction.objects.filter(
        created_at__gte=today_start_utc, created_at__lt=today_end_utc, transaction_type='DEPOSIT'
    )).aggregate(count=Count('id'), amount=Sum('amount'))
    today_withdraw_agg = _scope_txn(Transaction.objects.filter(
        created_at__gte=today_start_utc, created_at__lt=today_end_utc, transaction_type='WITHDRAW'
    )).aggregate(count=Count('id'), amount=Sum('amount'))
    yday_deposit_agg = _scope_txn(Transaction.objects.filter(
        created_at__gte=yday_start_utc, created_at__lt=yday_end_utc, transaction_type='DEPOSIT'
    )).aggregate(count=Count('id'), amount=Sum('amount'))
    yday_withdraw_agg = _scope_txn(Transaction.objects.filter(
        created_at__gte=yday_start_utc, created_at__lt=yday_end_utc, transaction_type='WITHDRAW'
    )).aggregate(count=Count('id'), amount=Sum('amount'))

    today_active_bettors = _scope_bet(Bet.objects.filter(created_at__gte=today_start_utc, created_at__lt=today_end_utc)).aggregate(n=Count('user_id', distinct=True))['n'] or 0
    yday_active_bettors = _scope_bet(Bet.objects.filter(created_at__gte=yday_start_utc, created_at__lt=yday_end_utc)).aggregate(n=Count('user_id', distinct=True))['n'] or 0

    today_new_users = _scope_user(User.objects.filter(is_staff=False, created_at__gte=today_start_utc, created_at__lt=today_end_utc)).count()
    yday_new_users = _scope_user(User.objects.filter(is_staff=False, created_at__gte=yday_start_utc, created_at__lt=yday_end_utc)).count()

    current_round_total_amount = 0
    current_round_total_bets = 0
    bets_by_number_list = []
    current_round_bettor_ids = set()
    current_round_active_bettors = 0
    if current_round:
        current_round_bets = _scope_bet(Bet.objects.filter(round=current_round))
        current_round_total_bets = current_round_bets.count()
        current_round_total_amount = current_round_bets.aggregate(Sum('chip_amount'))['chip_amount__sum'] or 0
        current_round_bettor_ids = set(
            str(uid) for uid in current_round_bets.values_list('user_id', flat=True).distinct()
        )
        try:
            if redis_client:
                watching_ids = redis_client.smembers('game_watching_users') or set()
                current_round_active_bettors = len(current_round_bettor_ids | watching_ids)
            else:
                current_round_active_bettors = len(current_round_bettor_ids)
        except Exception:
            current_round_active_bettors = len(current_round_bettor_ids)
        per_number = current_round_bets.values('number').annotate(
            amount=Sum('chip_amount'),
            count=Count('id')
        ).order_by('number')
        per_number_map = {r['number']: r for r in per_number}
        for number in range(1, 7):
            r = per_number_map.get(number, {})
            bets_by_number_list.append({
                'number': number,
                'amount': float(r.get('amount') or 0),
                'count': r.get('count') or 0
            })

    # Prepare response data (JSON-serializable)
    data = {
        'timer': timer,
        'status': status,
        'round_id': current_round.round_id if current_round else None,
        'current_round': {
            'round_id': current_round.round_id if current_round else None,
            'dice_result': current_round.dice_result if current_round else None,
            'dice_result_list': current_round.dice_result_list if current_round else [],
            'dice_1': current_round.dice_1 if current_round else None,
            'dice_2': current_round.dice_2 if current_round else None,
            'dice_3': current_round.dice_3 if current_round else None,
            'dice_4': current_round.dice_4 if current_round else None,
            'dice_5': current_round.dice_5 if current_round else None,
            'dice_6': current_round.dice_6 if current_round else None,
        } if current_round else None,
        'current_round_total_bets': current_round_total_bets,
        'current_round_total_amount': float(current_round_total_amount),
        'current_round_active_bettors': current_round_active_bettors,
        'bets_by_number_list': bets_by_number_list,
        'total_bets': total_bets_count,
        'total_amount': float(overall_total_amount),
        'total_payout': float(overall_total_payout),
        'total_profit': float(overall_total_profit),
        'daily': {
            'timezone': 'IST',
            'today': {
                'date': str(today_ist_date),
                'deposits_count': int(today_deposit_agg.get('count') or 0),
                'deposits_amount': float(today_deposit_agg.get('amount') or 0),
                'withdraws_count': int(today_withdraw_agg.get('count') or 0),
                'withdraws_amount': float(today_withdraw_agg.get('amount') or 0),
                'bets_count': int(today_bet_agg.get('bets_count') or 0),
                'bets_amount': float(today_bet_agg.get('bets_amount') or 0),
                'payout_amount': float(today_bet_agg.get('payout_amount') or 0),
                'profit': float((today_bet_agg.get('bets_amount') or 0) - (today_bet_agg.get('payout_amount') or 0)),
                'active_bettors': int(today_active_bettors or 0),
                'new_users': int(today_new_users or 0),
            },
            'yesterday': {
                'date': str(yday_ist_date),
                'deposits_count': int(yday_deposit_agg.get('count') or 0),
                'deposits_amount': float(yday_deposit_agg.get('amount') or 0),
                'withdraws_count': int(yday_withdraw_agg.get('count') or 0),
                'withdraws_amount': float(yday_withdraw_agg.get('amount') or 0),
                'bets_count': int(yday_bet_agg.get('bets_count') or 0),
                'bets_amount': float(yday_bet_agg.get('bets_amount') or 0),
                'payout_amount': float(yday_bet_agg.get('payout_amount') or 0),
                'profit': float((yday_bet_agg.get('bets_amount') or 0) - (yday_bet_agg.get('payout_amount') or 0)),
                'active_bettors': int(yday_active_bettors or 0),
                'new_users': int(yday_new_users or 0),
            },
        },
    }
    # The cache key is global, so only God's platform-wide payload may populate it.
    if sees_all_data(effective_admin):
        try:
            cache.set(ADMIN_DASHBOARD_DATA_CACHE_KEY, json.dumps(data), ADMIN_DASHBOARD_DATA_TTL)
        except Exception:
            pass
    return JsonResponse(data)

@admin_required
def set_individual_dice_view(request):
    """Admin view to set individual dice values (1-6 for each of 6 dice)
    All dice values must be provided and time restrictions are enforced
    """
    if request.method == 'POST':
        try:
            # Get current round state using helper
            from .utils import get_current_round_state, get_game_setting
            
            # Enforce local fallback for redis_client if global is missing/None
            local_redis = None
            try:
                 local_redis = redis_client
            except NameError:
                 pass
            
            round_obj, timer, status, _ = get_current_round_state(local_redis)

            # Get dice result time (needed for restriction check and finalization logic)
            dice_result_time = get_game_setting('DICE_RESULT_TIME', 51)

            # Check timer restriction
            if timer >= dice_result_time:
                    messages.error(request, f'Cannot set dice values after {dice_result_time} seconds. Use Manual Adjust mode to override.')
                    return redirect('dice_control')
            
            if not round_obj:
                messages.error(request, 'No active round')
                return redirect('dice_control')
            
            # Collect dice values (all dice required)
            dice_values_list = []  # For calculating result

            for i in range(1, 7):
                dice_value = request.POST.get(f'dice_{i}', '').strip()
                if dice_value:
                    try:
                        value = int(dice_value)
                        if 1 <= value <= 6:
                            dice_values_list.append(value)
                        else:
                            messages.error(request, f'Dice {i} value must be between 1-6')
                            return redirect('dice_control')
                    except ValueError:
                        messages.error(request, f'Invalid value for dice {i}')
                        return redirect('dice_control')
                else:
                    messages.error(request, f'Dice {i} value is required')
                    return redirect('dice_control')
            else:
                # Normal mode - must have all 6 values
                if len(dice_values_list) != 6:
                    messages.error(request, 'All 6 dice values are required')
                    return redirect('dice_control')
            
            # Apply updates to round object
            for i, value in enumerate(dice_values_list):
                setattr(round_obj, f'dice_{i+1}', value)
            
            # If we have at least some dice values, calculate result
            if dice_values_list:
                # Filter out None values for calculation
                valid_dice = [d for d in dice_values_list if d is not None]
                if valid_dice:
                    from .utils import determine_winning_number
                    most_common = determine_winning_number(valid_dice)
                    
                    round_obj.dice_result = most_common
                    
                    # Only finalize the round (status, payouts, broadcast) if we are at or past result time
                    should_finalize = timer >= dice_result_time
                    
                    if should_finalize:
                        round_obj.status = 'RESULT'
                        if not round_obj.result_time:
                            round_obj.result_time = timezone.now()
                    
                    round_obj.save()
                    
                    # Create or update dice result record
                    DiceResult.objects.update_or_create(
                        round=round_obj,
                        defaults={
                            'result': most_common,
                            'set_by': request.user
                        }
                    )
                    
                    # Update Redis with all current dice values
                    if redis_client:
                        try:
                            # 1. Update legacy current_round key
                            round_data = redis_client.get('current_round')
                            if round_data:
                                round_data = json.loads(round_data)
                                round_data['dice_result'] = most_common
                                # Update all dice values (use current from DB)
                                for i in range(1, 7):
                                    dice_val = getattr(round_obj, f'dice_{i}', None)
                                    if dice_val is not None:
                                        round_data[f'dice_{i}'] = dice_val
                                
                                if should_finalize:
                                    round_data['status'] = 'RESULT'
                                
                                redis_client.set('current_round', json.dumps(round_data))
                            
                            # 2. Update manual_dice_result for the engine to pick up
                            # Format: "1,2,3,4,5,6"
                            if all(d is not None for d in complete_dice):
                                manual_dice_str = ",".join([str(d) for d in complete_dice])
                                redis_client.set("manual_dice_result", manual_dice_str, ex=300)
                        except Exception:
                            pass
                    
                    # ONLY calculate payouts and broadcast if finalizing
                    if should_finalize:
                        # Calculate payouts based on dice values (frequency-based)
                        from .views import calculate_payouts
                        # Get complete dice values from round object
                        complete_dice = [
                            round_obj.dice_1, round_obj.dice_2, round_obj.dice_3,
                            round_obj.dice_4, round_obj.dice_5, round_obj.dice_6
                        ]
                        # Only calculate if we have all 6 dice values
                        if all(d is not None for d in complete_dice):
                            calculate_payouts(round_obj, dice_result=most_common, dice_values=complete_dice)
                        
                        # Broadcast to WebSocket
                        from channels.layers import get_channel_layer
                        from asgiref.sync import async_to_sync
                        channel_layer = get_channel_layer()
                        if channel_layer:
                            try:
                                async_to_sync(channel_layer.group_send)(
                                    'game_room',
                                    {
                                        'type': 'dice_result',
                                        'result': most_common,
                                        'dice_values': complete_dice if all(d is not None for d in complete_dice) else valid_dice,
                                        'round_id': round_obj.round_id,
                                    }
                                )
                            except Exception:
                                pass
                    
                    mode_text = " (Pre-set)" if not should_finalize else ""
                    
                    updated_text = ", ".join([f"D{i+1}:{v}" for i, v in enumerate(dice_values_list)])
                    messages.success(request, f'Dice values updated{mode_text}: {updated_text} | Result: {most_common}')
                else:
                    messages.error(request, 'At least one valid dice value is required')
            else:
                messages.error(request, 'No dice values provided')

        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            from django.http import HttpResponse
            return HttpResponse(f"<html><body><h1>Error setting dice values</h1><pre>{error_trace}</pre><br><a href='/game-admin/dice-control/'>Back to Dice Control</a></body></html>")
    
    return redirect('dice_control')

@admin_required
def dice_control(request):
    """Dice control page with PIN protection"""
    try:

        if not has_menu_permission(request.user, 'dice_control'):
            messages.error(request, 'You do not have permission to access dice control.')
            return redirect('admin_dashboard')

        # PIN protection
        if request.method == 'POST' and 'pin' in request.POST:
            pin = request.POST.get('pin')
            if pin == getattr(settings, 'DICE_CONTROL_PIN', '1234'):
                request.session['dice_control_verified'] = True
                request.session.modified = True
                # Continue to GET logic
            else:
                return render(request, 'admin/dice_control_pin.html', {'error': 'Invalid PIN'})

        # Check if they are trying to perform an action (POST) without verification
        if request.method == 'POST' and not request.session.get('dice_control_verified'):
            # This handles cases where they might try to submit a dice control form directly
            return render(request, 'admin/dice_control_pin.html', {'error': 'Please verify your PIN first.'})

        if not request.session.get('dice_control_verified'):
            return render(request, 'admin/dice_control_pin.html')
            
        # Get current round state using helper
        from .utils import get_current_round_state, get_game_setting
        
        # Enforce local fallback for redis_client if global is missing/None
        local_redis = None
        try:
                local_redis = redis_client
        except NameError:
                pass
                
        current_round, timer, status, _ = get_current_round_state(local_redis)
        
        # Get stats for current round
        current_round_total_amount = 0
        current_round_total_bets = 0
        bets_by_number_list = []
        
        if current_round:
            current_round_bets = Bet.objects.filter(round=current_round)
            current_round_total_bets = current_round_bets.count()
            current_round_total_amount = current_round_bets.aggregate(Sum('chip_amount'))['chip_amount__sum'] or 0
            
            # Calculate bets by number
            for number in range(1, 7):
                number_bets = current_round_bets.filter(number=number)
                amount = number_bets.aggregate(Sum('chip_amount'))['chip_amount__sum'] or 0
                count = number_bets.count()
                bets_by_number_list.append({
                    'number': number,
                    'amount': amount,
                    'count': count
                })
        
        # Get dice mode
        from .views import get_dice_mode
        dice_mode = get_dice_mode()
        
        # Get timing settings for current round
        betting_close_time = current_round.betting_close_seconds if current_round else get_game_setting('BETTING_CLOSE_TIME', 30)
        dice_result_time = current_round.dice_result_seconds if current_round else get_game_setting('DICE_RESULT_TIME', 51)
        round_end_time = current_round.round_end_seconds if current_round else get_game_setting('ROUND_END_TIME', 80)

        context = get_admin_context(request, {
            'current_round': current_round,
            'timer': timer,
            'status': status,
            'dice_mode': dice_mode,
            'current_round_total_bets': current_round_total_bets,
            'current_round_total_amount': current_round_total_amount,
            'bets_by_number_list': bets_by_number_list,
            'betting_close_time': betting_close_time,
            'dice_result_time': dice_result_time,
            'round_end_time': round_end_time,
            'page': 'dice-control',
        })
        
        return render(request, 'admin/dice_control.html', context)

    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        from django.http import HttpResponse
        return HttpResponse(f"<html><body><h1>Error loading Dice Control Page</h1><pre>{error_trace}</pre><br><a href='/game-admin/dashboard/'>Back to Dashboard</a></body></html>")

@admin_required
def dice_controlled_rounds(request):
    """Redirect to Recent Rounds with controlled-only filter (controlled dice are shown there only)."""
    if not has_menu_permission(request.user, 'dice_control'):
        messages.error(request, 'You do not have permission to view this page.')
        return redirect('admin_dashboard')
    from django.urls import reverse
    return redirect(reverse('recent_rounds') + '?controlled_only=1')

@admin_required
def recent_rounds(request):
    """Sidebar removed — Recent games are under Games → open a game."""
    if has_menu_permission(request.user, 'games') or has_menu_permission(request.user, 'recent_rounds') or has_menu_permission(request.user, 'dashboard'):
        return redirect('admin_game_detail', game_slug='dice')
    messages.error(request, 'You do not have permission to view games.')
    return redirect('admin_dashboard')


@admin_required
def round_details(request, round_id):
    """Round details page showing all users who bet on this round"""
    try:
        round_obj = GameRound.objects.get(round_id=round_id)
    except GameRound.DoesNotExist:
        messages.error(request, 'Round not found.')
        return redirect('recent_rounds')
    
    # Get all bets for this round
    round_bets = Bet.objects.filter(round=round_obj).select_related('user').order_by('-created_at')
    
    # Calculate round stats
    total_bets_count = round_bets.count()
    total_bet_amount = round_bets.aggregate(Sum('chip_amount'))['chip_amount__sum'] or 0
    total_winners = round_bets.filter(is_winner=True).count()
    total_payouts = round_bets.aggregate(Sum('payout_amount'))['payout_amount__sum'] or 0
    
    # Get unique users who bet on this round
    unique_users = User.objects.filter(bets__round=round_obj).distinct()
    
    # Calculate bets by number
    bets_by_number_list = []
    for number in range(1, 7):
        number_bets = round_bets.filter(number=number)
        amount = number_bets.aggregate(Sum('chip_amount'))['chip_amount__sum'] or 0
        count = number_bets.count()
        bets_by_number_list.append({
            'number': number,
            'amount': amount,
            'count': count
        })
    
    context = get_admin_context(request, {
        'round': round_obj,
        'round_bets': round_bets,
        'unique_users': unique_users,
        'total_bets_count': total_bets_count,
        'total_bet_amount': total_bet_amount,
        'total_winners': total_winners,
        'total_payouts': total_payouts,
        'bets_by_number_list': bets_by_number_list,
        'page': 'round-details',
    })
    
    return render(request, 'admin/round_details.html', context)

@csrf_exempt
def user_details(request, user_id):
    """User details page showing all their bets and information"""
    logger = logging.getLogger(__name__)
    # Check admin permission manually to avoid redirect issues with @admin_required
    if not request.user.is_authenticated:
        from django.urls import reverse
        try:
            login_url = reverse('admin_login')
        except:
            login_url = '/game-admin/login/'
        return redirect(f"{login_url}?next={request.get_full_path()}")
    
    if not is_admin(request.user):
        messages.error(request, 'You do not have permission to access this page.')
        return redirect('/game-admin/login/')
    
    try:
        user = User.objects.select_related('worker', 'works_under').get(pk=user_id)
    except User.DoesNotExist:
        messages.error(request, 'User not found.')
        return redirect('recent_rounds')

    # Hierarchy pages: Admin profile → Agents; Agent profile → Users
    if request.method == 'GET':
        if is_franchise_admin(user) and is_super_admin(request.user):
            return redirect('franchise_admin_details', admin_id=user.id)
        if is_agent(user):
            if is_super_admin(request.user) or is_franchise_admin(request.user) or request.user.id == user.id:
                return redirect('agent_details', agent_id=user.id)

    def _actor_can_manage_this_player(actor, player):
        if player.is_superuser or player.is_staff:
            return False
        if is_super_admin(actor):
            return True
        owner_ids = _owner_ids_for_scope(actor)
        if owner_ids is None:
            return True
        return player.worker_id in owner_ids

    # Handle block/unblock and balance adjustment POST request
    if request.method == 'POST':
        action = request.POST.get('action')
        amount = request.POST.get('amount', '0').strip()
        utr_number = request.POST.get('utr_number', '').strip()

        # Block / Unblock user (any admin can block; cannot block self or superuser)
        if action in ('block', 'unblock'):
            if user_id == request.user.id:
                messages.error(request, 'You cannot block yourself.')
                return redirect(request.get_full_path())
            if user.is_superuser:
                messages.error(request, 'Cannot block a superuser.')
                return redirect(request.get_full_path())
            new_active = (action == 'unblock')
            if user.is_active != new_active:
                user.is_active = new_active
                user.save()
                # Invalidate Redis cache so next API call sees updated is_active
                try:
                    if redis_client:
                        cache_key = f"user_session:{user.id}"
                        redis_client.delete(cache_key)
                except Exception:
                    pass
            messages.success(request, f'User {user.username} has been {"unblocked" if new_active else "blocked"}.')
            return redirect(request.get_full_path())

        if action == 'change_password':
            if not _actor_can_manage_this_player(request.user, user):
                messages.error(request, 'You do not have permission to change this user\'s password.')
                return redirect(request.get_full_path())
            new_password = (request.POST.get('new_password') or '').strip()
            new_password_confirm = (request.POST.get('new_password_confirm') or '').strip()
            if not new_password:
                messages.error(request, 'New password is required.')
            elif len(new_password) < 4:
                messages.error(request, 'Password must be at least 4 characters.')
            elif new_password != new_password_confirm:
                messages.error(request, 'Passwords do not match.')
            else:
                user.set_password(new_password)
                user.save(update_fields=['password'])
                try:
                    if redis_client:
                        redis_client.delete(f"user_session:{user.id}")
                except Exception:
                    pass
                messages.success(request, f'Password updated for "{user.username}".')
            return redirect(request.get_full_path())

        # Debug logging
        logger.info(f"Balance adjustment request: user={user_id}, action={action}, amount={amount}, utr={utr_number}, user={request.user.username}, authenticated={request.user.is_authenticated}, is_admin={is_admin(request.user)}")
        
        # Validate UTR number for deposit and withdraw actions
        if action in ['deposit', 'withdraw'] and not utr_number:
            messages.error(request, f'UTR number is mandatory for {action}.')
            return redirect(request.get_full_path())

        try:
            amount = Decimal(amount)
            if amount <= 0:
                messages.error(request, 'Amount must be greater than 0.')
                return redirect(request.get_full_path())

            wallet, _ = Wallet.objects.get_or_create(user=user)
            balance_before = wallet.balance

            if action == 'deposit':
                # Add money to user balance
                # Deposit money needs to be rotated 1 time
                amount_decimal = Decimal(str(amount))
                
                # 1️⃣ Update DB atomically (balance + total_deposits for withdrawable rule)
                Wallet.objects.filter(pk=wallet.pk).update(
                    balance=F('balance') + amount_decimal,
                    total_deposits=F('total_deposits') + int(amount_decimal),
                )
                wallet.refresh_from_db()
                
                transaction_type = 'DEPOSIT'
                description = f"deposited by support_team (UTR: {utr_number})"
                
                # Also create a DepositRequest record so it shows in deposit list
                DepositRequest.objects.create(
                    user=user,
                    amount=amount_decimal,
                    status='APPROVED',
                    payment_method=None, # Manual adjustment
                    payment_reference=utr_number,
                    processed_by=request.user,
                    processed_at=timezone.now(),
                    admin_note=f'Manual deposit by support team. UTR: {utr_number}'
                )
                
                # 2️⃣ Update Redis atomically using INCRBYFLOAT
                try:
                    if redis_client:
                        redis_client.incrbyfloat(f"user_balance:{user.id}", float(amount_decimal))
                        logger.info(f"Updated Redis balance cache for user {user.id} after deposit: {wallet.balance}")
                except Exception as redis_err:
                    logger.error(f"Failed to update Redis balance for user {user.id}: {redis_err}")

                messages.success(request, f'Successfully deposited ₹{amount} to {user.username}\'s account.')
            elif action == 'withdraw':
                # Subtract money from user balance
                amount_decimal = Decimal(str(amount))
                
                # Check if balance is sufficient
                if wallet.balance < amount_decimal:
                    messages.error(request, f'Insufficient balance. Current balance: ₹{wallet.balance}')
                    return redirect(request.get_full_path())
                
                # 1️⃣ Update DB atomically
                Wallet.objects.filter(pk=wallet.pk).update(balance=F('balance') - amount_decimal)
                wallet.refresh_from_db()
                
                transaction_type = 'WITHDRAW'
                description = f"withdrawn by support_team (UTR: {utr_number})"
                
                # Also create a WithdrawRequest record so it shows in withdrawal list
                WithdrawRequest.objects.create(
                    user=user,
                    amount=amount_decimal,
                    status='COMPLETED',
                    withdrawal_method='ADMIN_ADJUSTMENT',
                    withdrawal_details=f'Withdrawn by Support Team. UTR: {utr_number}',
                    processed_by=request.user,
                    processed_at=timezone.now(),
                    admin_note=f'Manual withdrawal by support team. UTR: {utr_number}',
                    utr_number=utr_number
                )
                
                # 2️⃣ Update Redis atomically using INCRBYFLOAT (negative)
                try:
                    if redis_client:
                        redis_client.incrbyfloat(f"user_balance:{user.id}", -float(amount_decimal))
                        logger.info(f"Updated Redis balance cache for user {user.id}: {wallet.balance}")
                except Exception as redis_err:
                    logger.error(f"Failed to update Redis balance for user {user.id}: {redis_err}")

                messages.success(request, f'Successfully withdrew ₹{amount} from {user.username}\'s account.')
            elif action == 'adjust_remove':
                # Subtract money from user balance (Adjustment)
                amount_decimal = Decimal(str(amount))
                
                # Check if balance is sufficient
                if wallet.balance < amount_decimal:
                    messages.error(request, f'Insufficient balance for adjustment. Current balance: ₹{wallet.balance}')
                    return redirect(request.get_full_path())
                
                # 1️⃣ Update DB atomically (F is imported at module level)
                Wallet.objects.filter(pk=wallet.pk).update(balance=F('balance') - amount_decimal)
                wallet.refresh_from_db()
                
                transaction_type = 'WITHDRAW'
                description = f"balance adjustment (removed) by admin"
                
                # 2️⃣ Update Redis atomically using INCRBYFLOAT (negative)
                try:
                    if redis_client:
                        redis_client.incrbyfloat(f"user_balance:{user.id}", -float(amount_decimal))
                        logger.info(f"Updated Redis balance cache for user {user.id} after adjustment: {wallet.balance}")
                except Exception as redis_err:
                    logger.error(f"Failed to update Redis balance for user {user.id}: {redis_err}")

                messages.success(request, f'Successfully adjusted balance: Removed ₹{amount} from {user.username}\'s account.')
            else:
                messages.error(request, 'Invalid action.')
                return redirect(request.get_full_path())

            # Create transaction record
            Transaction.objects.create(
                user=user,
                transaction_type=transaction_type,
                amount=amount_decimal,
                balance_before=balance_before,
                balance_after=wallet.balance,
                description=description
            )

            return redirect(request.get_full_path())

        except ValueError:
            messages.error(request, 'Invalid amount format.')
            return redirect(request.get_full_path())
        except Exception as e:
            logger.error(f"Error adjusting balance for user {user_id}: {e}")
            messages.error(request, f'Error processing request: {str(e)}')
            return redirect(request.get_full_path())

    # Get user's wallet
    wallet, _ = Wallet.objects.get_or_create(user=user)
    
    # Get active tab from query params
    active_tab = request.GET.get('tab', 'all')
    
    # Get all bets by this user
    user_bets = Bet.objects.filter(user=user).select_related('round').order_by('-created_at')
    if active_tab == 'bets':
        user_bets = user_bets[:200]
    else:
        user_bets = user_bets[:50]
    
    # Calculate user stats (always needed)
    total_bets = Bet.objects.filter(user=user).count()
    total_bet_amount = Bet.objects.filter(user=user).aggregate(Sum('chip_amount'))['chip_amount__sum'] or 0
    total_wins = Bet.objects.filter(user=user, is_winner=True).count()
    total_payouts = Bet.objects.filter(user=user).aggregate(Sum('payout_amount'))['payout_amount__sum'] or 0
    
    # Get user's transactions
    user_transactions = Transaction.objects.filter(user=user).order_by('-created_at')
    if active_tab == 'transactions':
        user_transactions = user_transactions[:200]
    else:
        user_transactions = user_transactions[:50]
    
    # Get user's deposit requests
    user_deposits = DepositRequest.objects.filter(user=user).order_by('-created_at')
    if active_tab == 'deposits':
        user_deposits = user_deposits[:100]
    else:
        user_deposits = user_deposits[:20]

    # Get user's withdraw requests
    user_withdrawals = WithdrawRequest.objects.filter(user=user).order_by('-created_at')
    if active_tab == 'withdrawals':
        user_withdrawals = user_withdrawals[:100]
    else:
        user_withdrawals = user_withdrawals[:20]
    
    # Admin / Agent specific stats + hierarchy lists
    admin_stats = None
    assigned_users = None
    agent_rows = None
    staff_role_label = 'Player'
    parent_admin = None
    if is_super_admin(user):
        staff_role_label = 'Super Admin'
    elif is_franchise_admin(user):
        staff_role_label = 'Admin'
    elif is_agent(user):
        staff_role_label = 'Agent'
        parent_admin = user.works_under
    elif user.is_staff:
        staff_role_label = 'Staff'

    if user.is_staff:
        from datetime import timedelta
        today = timezone.now().date()
        report_range = request.GET.get('report_range', 'today')
        start_date = today
        end_date = today
        if report_range == 'week':
            start_date = today - timedelta(days=today.weekday())
        elif report_range == 'month':
            start_date = today.replace(day=1)
        elif report_range == 'custom':
            try:
                start_date_str = request.GET.get('start_date')
                end_date_str = request.GET.get('end_date')
                if start_date_str:
                    start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
                if end_date_str:
                    end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
            except (ValueError, TypeError):
                pass

        assigned_users_qs = User.objects.filter(worker=user, is_staff=False).order_by('-date_joined')
        assigned_users_count = assigned_users_qs.count()
        deposits_qs = DepositRequest.objects.filter(
            processed_by=user, status='APPROVED',
            processed_at__date__gte=start_date, processed_at__date__lte=end_date,
        )
        withdrawals_qs = WithdrawRequest.objects.filter(
            processed_by=user, status='COMPLETED',
            processed_at__date__gte=start_date, processed_at__date__lte=end_date,
        )
        admin_stats = {
            'assigned_users_count': assigned_users_count,
            'report_range': report_range,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'deposits_count': deposits_qs.count(),
            'deposits_amount': deposits_qs.aggregate(Sum('amount'))['amount__sum'] or 0,
            'withdrawals_count': withdrawals_qs.count(),
            'withdrawals_amount': withdrawals_qs.aggregate(Sum('amount'))['amount__sum'] or 0,
        }
        assigned_users = assigned_users_qs[:100]

    # Show Block/Unblock to any admin when viewing another user who is not a superuser
    can_block_user = (request.user.id != user_id and not user.is_superuser)
    can_change_password = _actor_can_manage_this_player(request.user, user)
    owner = getattr(user, 'worker', None)
    owner_is_agent = bool(owner and is_agent(owner))
    owner_is_admin = bool(owner and is_franchise_admin(owner))
    context = get_admin_context(request, {
        'player': user,
        'wallet': wallet,
        # Wallet formula: unavailable = max(0, total_deposits - turnover), withdrawable = balance - unavailable
        'wallet_unavailable': wallet.computed_unavailable_balance,
        'wallet_withdrawable': wallet.withdrawable_balance,
        'user_bets': user_bets,
        'total_bets': total_bets,
        'total_bet_amount': total_bet_amount,
        'total_wins': total_wins,
        'total_payouts': total_payouts,
        'user_transactions': user_transactions,
        'user_deposits': user_deposits,
        'user_withdrawals': user_withdrawals,
        'active_tab': active_tab,
        'admin_stats': admin_stats,
        'assigned_users': assigned_users,
        'agent_rows': agent_rows,
        'staff_role_label': staff_role_label,
        'parent_admin': parent_admin,
        'owner_is_agent': owner_is_agent,
        'owner_is_admin': owner_is_admin,
        'can_block_user': can_block_user,
        'can_change_password': can_change_password,
        'page': 'user-details',
    })
    
    return render(request, 'admin/user_details.html', context)

@admin_required
def testing_dashboard(request):
    """Testing dashboard for simulations and load testing"""
    if not is_super_admin(request.user):
        messages.error(request, 'Only super admins can access the testing dashboard.')
        return redirect('admin_dashboard')
    
    admin_profile = get_admin_profile(request.user)
    context = get_admin_context(request, {
        'page': 'testing-dashboard',
        'admin_profile': admin_profile,
    })
    return render(request, 'admin/testing_dashboard.html', context)

@admin_required
def start_simulation(request):
    """API endpoint to start user/bet simulation"""
    if not is_super_admin(request.user):
        return JsonResponse({'error': 'Unauthorized'}, status=403)
    
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            user_count = int(data.get('user_count', 10))
            bets_per_user = int(data.get('bets_per_user', 5))
            chip_amount = float(data.get('chip_amount', 10))
            
            # Use current request's host to determine base URL
            protocol = 'https' if request.is_secure() else 'http'
            host = request.get_host()
            load_tester.base_url = f"{protocol}://{host}"
            
            load_tester.run_simulation(user_count, bets_per_user, chip_amount)
            return JsonResponse({'status': 'started', 'results': load_tester.get_status()})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)
    
    return JsonResponse({'error': 'POST required'}, status=405)

@admin_required
def stop_simulation(request):
    """API endpoint to stop the ongoing simulation"""
    if not is_super_admin(request.user):
        return JsonResponse({'error': 'Unauthorized'}, status=403)
    
    load_tester.results['is_running'] = False
    return JsonResponse({'status': 'stopped'})

@admin_required
def simulation_status(request):
    """API endpoint to get simulation status"""
    if not is_super_admin(request.user):
        return JsonResponse({'error': 'Unauthorized'}, status=403)
    
    return JsonResponse(load_tester.get_status())

@admin_required
def all_bets(request):
    """All bets across every game (dice, roulette, trading, chicken road, vortex, …)."""
    if not has_menu_permission(request.user, 'all_bets'):
        messages.error(request, 'You do not have permission to view all bets.')
        return redirect('admin_dashboard')

    from .admin_game_stats import build_all_games_bets

    search_query = request.GET.get('search', '').strip()
    status_filter = request.GET.get('status', 'all')  # all, winners, losers
    game_filter = request.GET.get('game', 'all').strip().lower() or 'all'
    owner_filter = request.GET.get('owner', '').strip()

    rows, totals, game_options, owner_options = build_all_games_bets(
        request.user,
        search=search_query,
        status=status_filter,
        game_slug=game_filter,
        owner_param=owner_filter,
        limit=200,
    )

    owner_label = ''
    if owner_filter:
        for o in owner_options:
            if o['id'] == owner_filter:
                owner_label = o['label']
                break

    is_franchise_scope = not is_super_admin(request.user)
    context = get_admin_context(request, {
        'all_bets': rows,
        'total_bets_count': totals['total_bets_count'],
        'total_bets_amount': totals['total_bets_amount'],
        'total_payouts': totals['total_payouts'],
        'total_winners': totals['total_winners'],
        'search_query': search_query,
        'status_filter': status_filter,
        'game_filter': game_filter,
        'game_options': game_options,
        'owner_filter': owner_filter,
        'owner_options': owner_options,
        'owner_label': owner_label,
        'show_owner_filter': (
            is_super_admin(request.user)
            or (is_franchise_admin(request.user) and len(owner_options) > 1)
        ),
        'page': 'all-bets',
        'is_franchise_scope': is_franchise_scope,
        'scope_label': 'Your franchise' if is_franchise_scope else None,
    })

    return render(request, 'admin/all_bets.html', context)

@admin_required
def wallets(request):
    """Wallets page with filters and pagination"""
    if not has_menu_permission(request.user, 'wallets'):
        messages.error(request, 'You do not have permission to view wallets.')
        return redirect('admin_dashboard')

    effective_admin = get_effective_admin(request.user)
    base_wallets = Wallet.objects.select_related('user').all()
    base_wallets = _scope_by_owner(base_wallets, request.user, "user__worker")
        
    # Get filter parameters
    balance_filter = request.GET.get('balance', 'all')  # all, has_balance, zero
    search_query = request.GET.get('search', '').strip()
    sort_by = request.GET.get('sort', 'balance_desc')  # balance_desc, balance_asc, username_asc, username_desc
    try:
        page_number = int(request.GET.get('page', 1))
    except (ValueError, TypeError):
        page_number = 1
    
    wallets_query = base_wallets
    
    # Apply balance filter
    if balance_filter == 'has_balance':
        wallets_query = wallets_query.filter(balance__gt=0)
    elif balance_filter == 'zero':
        wallets_query = wallets_query.filter(balance=0)
    # 'all' shows all wallets
    
    # Apply search
    if search_query:
        wallets_query = wallets_query.filter(
            Q(user__username__icontains=search_query) |
            Q(user__phone_number__icontains=search_query)
        )
    
    # Apply sorting
    if sort_by == 'balance_desc':
        wallets_query = wallets_query.order_by('-balance')
    elif sort_by == 'balance_asc':
        wallets_query = wallets_query.order_by('balance')
    elif sort_by == 'username_asc':
        wallets_query = wallets_query.order_by('user__username')
    elif sort_by == 'username_desc':
        wallets_query = wallets_query.order_by('-user__username')
    else:
        wallets_query = wallets_query.order_by('-balance')  # default
    
    # Calculate stats from same base (franchise-scoped)
    total_wallets = base_wallets.count()
    total_balance = base_wallets.aggregate(Sum('balance'))['balance__sum'] or 0
    active_wallets = base_wallets.filter(balance__gt=0).count()
    zero_balance_wallets = base_wallets.filter(balance=0).count()
    
    # Pagination - 50 wallets per page for better performance
    paginator = Paginator(wallets_query, 50)
    try:
        page_obj = paginator.get_page(page_number)
    except Exception:
        page_obj = None
    
    is_franchise_scope = not is_super_admin(effective_admin)
    context = get_admin_context(request, {
        'wallets': page_obj if page_obj else wallets_query[:50],  # Fallback to first 50 if pagination fails
        'page_obj': page_obj,
        'total_wallets': total_wallets,
        'total_balance': total_balance,
        'active_wallets': active_wallets,
        'zero_balance_wallets': zero_balance_wallets,
        'balance_filter': balance_filter,
        'search_query': search_query,
        'sort_by': sort_by,
        'page': 'wallets',
        'is_franchise_scope': is_franchise_scope,
        'scope_label': 'Your franchise' if is_franchise_scope else None,
    })
    
    return render(request, 'admin/wallets.html', context)

@admin_required
def admin_profile(request):
    """Admin Profile: my info + deposit profile (manual vs automatic)."""
    user = request.user
    can_edit_deposit_profile = is_super_admin(user) or has_menu_permission(user, 'deposit_requests')

    if request.method == 'POST' and request.POST.get('form_type') == 'deposit_mode':
        if not can_edit_deposit_profile:
            messages.error(request, 'You do not have permission to change deposit profile.')
            return redirect('admin_profile')
        mode = (request.POST.get('deposit_mode') or '').strip().lower()
        if mode not in ('manual', 'automatic'):
            messages.error(request, 'Invalid deposit mode.')
            return redirect('admin_profile')

        GameSettings.objects.update_or_create(
            key='DEPOSIT_MODE',
            defaults={
                'value': mode,
                'description': 'Deposit flow: manual (screenshot/UTR admin) or automatic (unique amount + PhonePe feed)',
            },
        )
        apk_url = (request.POST.get('auto_deposit_apk_url') or '').strip()
        override = (request.POST.get('auto_deposit_apk_url_override') or '').strip()
        if override:
            apk_url = override
        GameSettings.objects.update_or_create(
            key='AUTO_DEPOSIT_APK_URL',
            defaults={
                'value': apk_url,
                'description': 'APK install link for automatic deposit PhonePe transaction reader',
            },
        )
        from accounts.auto_deposit import get_or_create_sync_token, rotate_sync_token
        if request.POST.get('rotate_sync_token') == '1':
            rotate_sync_token()
        else:
            get_or_create_sync_token()
        clear_game_setting_cache(['DEPOSIT_MODE', 'AUTO_DEPOSIT_APK_URL', 'AUTO_DEPOSIT_SYNC_TOKEN'])
        messages.success(
            request,
            f'Deposit profile saved: {"Automatic" if mode == "automatic" else "Manual"}.',
        )
        return redirect('admin_profile')

    if request.method == 'POST' and request.POST.get('form_type') == 'telegram':
        from . import telegram_utils as tg
        import secrets as _secrets
        link = tg.get_or_create_link(user)
        action = (request.POST.get('tg_action') or '').strip()
        if action == 'test':
            if not link.chat_id:
                messages.error(request, 'Connect Telegram first.')
            else:
                ok, err = tg.send_message(
                    link.chat_id,
                    '✅ Test message from the admin panel. Login alerts are working.',
                )
                if ok:
                    messages.success(request, 'Test message sent to your Telegram.')
                else:
                    messages.error(request, f'Could not send: {err}')
        elif action in ('pause', 'resume'):
            link.enabled = action == 'resume'
            link.save(update_fields=['enabled', 'updated_at'])
            messages.success(
                request,
                'Login alerts resumed.' if link.enabled else 'Login alerts paused.',
            )
        elif action == 'unlink':
            link.chat_id = ''
            link.linked_at = None
            link.save(update_fields=['chat_id', 'linked_at', 'updated_at'])
            messages.success(request, 'Telegram disconnected.')
        elif action == 'regenerate':
            link.link_code = _secrets.token_urlsafe(12)
            link.save(update_fields=['link_code', 'updated_at'])
            messages.success(request, 'New connect code generated.')
        return redirect('admin_profile')

    if request.method == 'POST' and request.POST.get('action') == 'change_password':
        current_password = request.POST.get('current_password', '').strip()
        new_password = request.POST.get('new_password', '').strip()
        confirm = request.POST.get('new_password_confirm', '').strip()
        if not current_password:
            messages.error(request, 'Enter your current password.')
        elif not user.check_password(current_password):
            messages.error(request, 'Current password is incorrect.')
        elif not new_password:
            messages.error(request, 'New password cannot be empty.')
        elif new_password != confirm:
            messages.error(request, 'New passwords do not match.')
        elif len(new_password) < 4:
            messages.error(request, 'New password must be at least 4 characters.')
        elif new_password == current_password:
            messages.error(request, 'New password must be different from the current password.')
        else:
            user.set_password(new_password)
            user.save()
            from django.contrib.auth import update_session_auth_hash
            update_session_auth_hash(request, user)
            messages.success(request, 'Password updated successfully.')
        return redirect('admin_profile')

    deposit_mode = str(get_game_setting('DEPOSIT_MODE', 'manual') or 'manual').strip().lower()
    if deposit_mode not in ('manual', 'automatic'):
        deposit_mode = 'manual'
    auto_deposit_apk_url = str(get_game_setting('AUTO_DEPOSIT_APK_URL', '') or '').strip()
    from accounts.auto_deposit import get_or_create_sync_token
    auto_deposit_sync_token = get_or_create_sync_token()

    if is_super_admin(user):
        role_label = 'Super Admin'
    elif is_franchise_admin(user):
        role_label = 'Franchise Admin'
    elif is_agent(user):
        role_label = 'Agent'
    elif user.is_staff:
        role_label = 'Staff'
    else:
        role_label = 'User'

    franchise_balance = None
    franchise_name = ''
    package_name = ''
    effective = get_effective_admin(user)
    if effective and not is_super_admin(effective):
        try:
            fb = FranchiseBalance.objects.get(user=effective)
            franchise_balance = fb.balance
            franchise_name = fb.franchise_name or ''
            package_name = getattr(fb, 'package_name', '') or ''
        except FranchiseBalance.DoesNotExist:
            franchise_balance = 0

    parent_admin = None
    if getattr(user, 'works_under_id', None):
        parent_admin = user.works_under
        # The God account stays confidential, even to its own direct reports
        if role_of(parent_admin) == 'GOD' and not is_god(user):
            parent_admin = None

    from . import telegram_utils as tg
    tg_link = tg.get_or_create_link(user)

    context = get_admin_context(request, {
        'page': 'profile',
        'role_label': role_label,
        'tg_configured': tg.is_configured(),
        'tg_bot_username': tg.get_bot_username(),
        'tg_linked': tg_link.is_linked,
        'tg_enabled': tg_link.enabled,
        'tg_chat_id': tg_link.chat_id,
        'tg_username': tg_link.telegram_username,
        'tg_linked_at': tg_link.linked_at,
        'tg_last_alert_at': tg_link.last_alert_at,
        'tg_last_error': tg_link.last_error,
        'tg_link_code': tg_link.link_code,
        'tg_connect_url': tg.build_connect_url(tg_link),
        'deposit_mode': deposit_mode,
        'auto_deposit_apk_url': auto_deposit_apk_url,
        'auto_deposit_sync_token': auto_deposit_sync_token,
        'can_edit_deposit_profile': can_edit_deposit_profile,
        'franchise_balance': franchise_balance,
        'franchise_name': franchise_name,
        'package_name': package_name,
        'parent_admin': parent_admin,
    })
    return render(request, 'admin/profile.html', context)


@admin_required
def deposit_requests(request):
    """Deposit requests page"""
    if not has_menu_permission(request.user, 'deposit_requests'):
        messages.error(request, 'You do not have permission to view deposit requests.')
        return redirect('admin_dashboard')

    # Get search and status filters
    search_query = request.GET.get('search', '').strip()
    status_filter = request.GET.get('status', '').strip()
    
    # Effective admin: workers see their assigned admin's queue; others see their own
    effective_admin = get_effective_admin(request.user)
    # Base queryset for deposit requests
    deposit_requests_qs = DepositRequest.objects.select_related('user', 'processed_by').all()
    # Each role sees the queue for players in its own subtree; God sees every queue.
    deposit_requests_qs = _scope_by_owner(deposit_requests_qs, request.user, "user__worker")
    
    # Apply filters
    if search_query:
        deposit_requests_qs = deposit_requests_qs.filter(
            Q(user__username__icontains=search_query) |
            Q(payment_reference__icontains=search_query) |
            Q(amount__icontains=search_query)
        )
        
    if status_filter:
        deposit_requests_qs = deposit_requests_qs.filter(status=status_filter)
        
    # Order by most recent
    deposit_requests_qs = deposit_requests_qs.order_by('-created_at')
    
    # Paginate: 50 per page for performance
    try:
        page_number = int(request.GET.get('page', 1))
    except (ValueError, TypeError):
        page_number = 1
    paginator = Paginator(deposit_requests_qs, 50)
    try:
        page_obj = paginator.get_page(page_number)
    except Exception:
        page_obj = paginator.get_page(1)
    deposit_requests_list = page_obj.object_list
    
    stats_base = _scope_by_owner(DepositRequest.objects.all(), request.user, "user__worker")
    total_requests = stats_base.count()
    pending_requests = stats_base.filter(status='PENDING').count()
    approved_requests = stats_base.filter(status='APPROVED').count()
    rejected_requests = stats_base.filter(status='REJECTED').count()
    total_amount = stats_base.filter(status='APPROVED').aggregate(Sum('amount'))['amount__sum'] or 0
    pending_amount = stats_base.filter(status='PENDING').aggregate(Sum('amount'))['amount__sum'] or 0
    
    # Latest request ID for polling
    latest_request_id = stats_base.order_by('-id').first()
    latest_id = latest_request_id.id if latest_request_id else 0
    
    my_franchise_balance = None
    my_franchise_balance_display = ''
    my_franchise_name = ''
    balance_is_low = False
    LOW_BALANCE_THRESHOLD = 1000
    if not is_super_admin(effective_admin):
        try:
            fb = FranchiseBalance.objects.get(user=effective_admin)
            my_franchise_balance = fb.balance
            my_franchise_name = fb.franchise_name or ''
            balance_is_low = my_franchise_balance < LOW_BALANCE_THRESHOLD
        except FranchiseBalance.DoesNotExist:
            my_franchise_balance = 0
            balance_is_low = True
        from .utils import format_indian_int
        my_franchise_balance_display = format_indian_int(my_franchise_balance)

    deposit_mode = str(get_game_setting('DEPOSIT_MODE', 'manual') or 'manual').strip().lower()
    if deposit_mode not in ('manual', 'automatic'):
        deposit_mode = 'manual'
    auto_deposit_apk_url = str(get_game_setting('AUTO_DEPOSIT_APK_URL', '') or '').strip()

    # Load auto list only when Automatic profile is active
    auto_transactions = []
    auto_total_amount = 0
    auto_total_count = 0
    auto_page_obj = None
    if deposit_mode == 'automatic':
        auto_qs = AutoDepositTransaction.objects.filter(status='CREDITED').select_related('user')
        auto_qs = _scope_by_owner(auto_qs, request.user, "user__worker")
        if search_query:
            auto_qs = auto_qs.filter(
                Q(utr__icontains=search_query) |
                Q(party_name__icontains=search_query) |
                Q(user__username__icontains=search_query) |
                Q(amount__icontains=search_query)
            )
        auto_qs = auto_qs.order_by('-payment_time', '-id')
        auto_total_count = auto_qs.count()
        auto_total_amount = auto_qs.aggregate(Sum('amount'))['amount__sum'] or 0
        auto_paginator = Paginator(auto_qs, 50)
        try:
            auto_page_obj = auto_paginator.get_page(page_number)
        except Exception:
            auto_page_obj = auto_paginator.get_page(1)
        auto_transactions = auto_page_obj.object_list

    context = get_admin_context(request, {
        'deposit_requests': deposit_requests_list,
        'page_obj': page_obj,
        'total_requests': total_requests,
        'pending_requests': pending_requests,
        'approved_requests': approved_requests,
        'rejected_requests': rejected_requests,
        'total_amount': total_amount,
        'pending_amount': pending_amount,
        'latest_request_id': latest_id,
        'search_query': search_query,
        'status_filter': status_filter,
        'page': 'deposit-requests',
        'my_franchise_balance': my_franchise_balance,
        'my_franchise_balance_display': my_franchise_balance_display,
        'my_franchise_name': my_franchise_name,
        'balance_is_low': balance_is_low,
        'deposit_mode': deposit_mode,
        'auto_deposit_apk_url': auto_deposit_apk_url,
        'auto_transactions': auto_transactions,
        'auto_page_obj': auto_page_obj,
        'auto_total_count': auto_total_count,
        'auto_total_amount': auto_total_amount,
        'sync_token': __import__('accounts.auto_deposit', fromlist=['get_or_create_sync_token']).get_or_create_sync_token(),
    })
    
    return render(request, 'admin/deposit_requests.html', context)


@admin_required
def check_new_deposit_requests(request):
    """API endpoint to check for new deposit requests"""
    last_id = int(request.GET.get('last_id', 0))
    
    effective_admin = get_effective_admin(request.user)
    new_requests = DepositRequest.objects.filter(id__gt=last_id, status='PENDING')
    new_requests = _scope_by_owner(new_requests, request.user, "user__worker")


    new_requests = new_requests.select_related('user').order_by('-id')[:10]
    
    requests_data = []
    for req in new_requests:
        requests_data.append({
            'id': req.id,
            'user': req.user.username,
            'amount': float(req.amount),
            'created_at': req.created_at.strftime('%Y-%m-%d %H:%M:%S'),
        })
    
    pending_qs = _scope_by_owner(
        DepositRequest.objects.filter(status='PENDING'), request.user, "user__worker"
    )
    return JsonResponse({
        'new_requests': requests_data,
        'latest_id': DepositRequest.objects.order_by('-id').first().id if DepositRequest.objects.exists() else last_id,
        'pending_count': pending_qs.count(),
    })

@admin_required
def approve_deposit(request, pk):
    """Approve a deposit request"""
    if request.method != 'POST':
        messages.error(request, 'Invalid request method. Please use the approve button.')
        return redirect('deposit_requests')
    
    try:
        deposit = DepositRequest.objects.select_related('user').get(pk=pk)
        effective_admin = get_effective_admin(request.user)
        if not _can_act_on_player(request.user, deposit.user):
            messages.error(request, 'You can only approve deposit requests for users in your tree.')
            return redirect('deposit_requests')
        with db_transaction.atomic():
            deposit = DepositRequest.objects.select_for_update().get(pk=pk)
            if deposit.status != 'PENDING':
                messages.error(request, 'Deposit request has already been processed.')
                return redirect('deposit_requests')
            
            # Calculate final amount with USDT bonus if applicable
            final_amount = deposit.amount
            bonus_amount = Decimal('0.00')
            if deposit.payment_method and deposit.payment_method.method_type in ['USDT_TRC20', 'USDT_BEP20']:
                bonus_amount = deposit.amount * Decimal('0.05')
                final_amount += bonus_amount
            final_amount_int = int(final_amount)
            
            # Franchise balance: cut from franchise Admin (Agent approvals use parent Admin wallet)
            ok, err = _deduct_franchise_for_actor(request.user, final_amount_int)
            if not ok:
                messages.error(request, err)
                return redirect('deposit_requests')
            
            wallet, _ = Wallet.objects.get_or_create(user=deposit.user)
            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
            balance_before = wallet.balance
            
            # 1️⃣ Update DB atomically (balance + total_deposits for withdrawable rule)
            Wallet.objects.filter(pk=wallet.pk).update(
                balance=F('balance') + final_amount,
                total_deposits=F('total_deposits') + int(final_amount),
            )
            wallet.refresh_from_db()
            
            deposit.status = 'APPROVED'
            deposit.processed_by = request.user
            deposit.processed_at = timezone.now()
            
            # Compulsory UTR verification
            utr = request.POST.get('utr', '').strip()
            if not utr:
                messages.error(request, 'UTR number is compulsory for approving deposits.')
                return redirect('deposit_requests')
            
            deposit.payment_reference = utr
            
            # If there's a note from the approval process, save it
            note = request.POST.get('note', '')
            if note:
                deposit.admin_note = note
            deposit.save()

            # 2️⃣ Update Redis atomically using INCRBYFLOAT
            try:
                from game.views import redis_client
                if redis_client:
                    redis_client.incrbyfloat(f"user_balance:{deposit.user.id}", float(final_amount))
                    logger.info(f"Updated Redis balance for user {deposit.user.id} after deposit approval: {wallet.balance}")
            except Exception as re_err:
                logger.error(f"Failed to update Redis balance for user {deposit.user.id} after deposit approval: {re_err}")
            
            Transaction.objects.create(
                user=deposit.user,
                transaction_type='DEPOSIT',
                amount=final_amount,
                balance_before=balance_before,
                balance_after=wallet.balance,
                description=f"Manual deposit approved #{deposit.id}{f' (Includes 5% USDT bonus: ₹{bonus_amount})' if bonus_amount > 0 else ''}{f'. {deposit.admin_note}' if deposit.admin_note else ''}",
            )

            # Handle referral bonus
            referrer = deposit.user.referred_by
            if referrer:
                from accounts.referral_logic import calculate_referral_bonus, check_and_award_milestone_bonus
                referral_bonus = calculate_referral_bonus(deposit.amount)
                if referral_bonus > 0:
                    ref_wallet, _ = Wallet.objects.get_or_create(user=referrer)
                    ref_wallet = Wallet.objects.select_for_update().get(pk=ref_wallet.pk)
                    ref_balance_before = ref_wallet.balance
                    # Referral bonus needs to be rotated 1 time (counts as deposit for withdrawable rule)
                    ref_wallet.add(referral_bonus, is_bonus=True)
                    Wallet.objects.filter(pk=ref_wallet.pk).update(total_deposits=F('total_deposits') + int(referral_bonus))
                    ref_wallet.refresh_from_db()

                    Transaction.objects.create(
                        user=referrer,
                        transaction_type='REFERRAL_BONUS',
                        amount=referral_bonus,
                        balance_before=ref_balance_before,
                        balance_after=ref_wallet.balance,
                        description=f"Referral bonus from {deposit.user.username}'s deposit of ₹{deposit.amount}",
                    )
                    # 2️⃣ Update Redis for referrer atomically
                    try:
                        if redis_client:
                            redis_client.incrbyfloat(f"user_balance:{referrer.id}", float(referral_bonus))
                    except: pass
                    # Check for milestone bonus
                    check_and_award_milestone_bonus(referrer)
        
        messages.success(request, f"Deposit request #{deposit.id} approved. ₹{final_amount} added to {deposit.user.username}'s wallet.{f' (Includes ₹{bonus_amount} USDT bonus)' if bonus_amount > 0 else ''}")
    except DepositRequest.DoesNotExist:
        messages.error(request, 'Deposit request not found.')
    except Exception as e:
        messages.error(request, f'Error approving deposit: {str(e)}')
        import traceback
        traceback.print_exc()
    
    return redirect('deposit_requests')

@admin_required
def reject_deposit(request, pk):
    """Reject a deposit request"""
    if request.method == 'POST':
        note = request.POST.get('note', '')
        try:
            deposit = DepositRequest.objects.select_related('user').get(pk=pk)
            effective_admin = get_effective_admin(request.user)
            if not _can_act_on_player(request.user, deposit.user):
                messages.error(request, 'You can only reject deposit requests for users in your tree.')
                return redirect('deposit_requests')
            with db_transaction.atomic():
                deposit = DepositRequest.objects.select_for_update().get(pk=pk)
                if deposit.status != 'PENDING':
                    messages.error(request, 'Deposit request has already been processed.')
                    return redirect('deposit_requests')

                deposit.status = 'REJECTED'
                deposit.admin_note = note
                deposit.processed_by = request.user
                deposit.processed_at = timezone.now()
                deposit.save()

            messages.success(request, f'Deposit request #{deposit.id} rejected.')
        except DepositRequest.DoesNotExist:
            messages.error(request, 'Deposit request not found.')
        except Exception as e:
            messages.error(request, f'Error rejecting deposit: {str(e)}')
            import traceback
            traceback.print_exc()

    return redirect('deposit_requests')

@admin_required
def edit_deposit_amount(request, pk):
    """Edit deposit request amount"""
    if request.method != 'POST':
        messages.error(request, 'Invalid request method. Please use the edit button.')
        return redirect('deposit_requests')

    try:
        deposit = DepositRequest.objects.select_related('user').get(pk=pk)
        effective_admin = get_effective_admin(request.user)
        if not _can_act_on_player(request.user, deposit.user):
            messages.error(request, 'You can only edit deposit requests for users in your tree.')
            return redirect('deposit_requests')
        with db_transaction.atomic():
            deposit = DepositRequest.objects.select_for_update().get(pk=pk)
            if deposit.status != 'PENDING':
                messages.error(request, 'Deposit request has already been processed.')
                return redirect('deposit_requests')

            old_amount = deposit.amount
            new_amount = decimal.Decimal(request.POST.get('new_amount', '0').strip())
            edit_reason = request.POST.get('edit_reason', '').strip()

            if new_amount <= 0:
                messages.error(request, 'Amount must be greater than 0.')
                return redirect('deposit_requests')

            # Update the amount
            deposit.amount = new_amount

            # Add edit information to admin_note
            edit_info = f"[AMOUNT EDITED: ₹{old_amount} → ₹{new_amount}"
            if edit_reason:
                edit_info += f" | Reason: {edit_reason}"
            edit_info += "]"

            if deposit.admin_note:
                deposit.admin_note += " | " + edit_info
            else:
                deposit.admin_note = edit_info

            deposit.save()

        messages.success(request, f"Deposit request #{deposit.id} amount updated from ₹{old_amount} to ₹{new_amount}.")
    except DepositRequest.DoesNotExist:
        messages.error(request, 'Deposit request not found.')
    except decimal.InvalidOperation:
        messages.error(request, 'Invalid amount format.')
    except Exception as e:
        messages.error(request, f'Error updating deposit amount: {str(e)}')
        import traceback
        traceback.print_exc()

    return redirect('deposit_requests')


@admin_required
def withdraw_requests(request):
    """Withdraw requests page"""
    if not has_menu_permission(request.user, 'withdraw_requests'):
        messages.error(request, 'You do not have permission to view withdraw requests.')
        return redirect('admin_dashboard')

    # Get search and status filters
    search_query = request.GET.get('search', '').strip()
    status_filter = request.GET.get('status', '').strip()

    effective_admin = get_effective_admin(request.user)
    withdraw_requests_list = WithdrawRequest.objects.select_related('user', 'processed_by').all()
    withdraw_requests_list = _scope_by_owner(withdraw_requests_list, request.user, "user__worker")
    
    # Apply filters
    if search_query:
        withdraw_requests_list = withdraw_requests_list.filter(
            Q(user__username__icontains=search_query) |
            Q(user__phone_number__icontains=search_query) |
            Q(withdrawal_details__icontains=search_query) |
            Q(amount__icontains=search_query)
        )
        
    if status_filter:
        if status_filter == 'SUCCESS':
            withdraw_requests_list = withdraw_requests_list.filter(status__in=['APPROVED', 'COMPLETED'])
        else:
            withdraw_requests_list = withdraw_requests_list.filter(status=status_filter)
        
    # Order by most recent
    withdraw_requests_list = withdraw_requests_list.order_by('-created_at')

    stats_base = _scope_by_owner(WithdrawRequest.objects.all(), request.user, "user__worker")
    total_requests = stats_base.count()
    pending_requests = stats_base.filter(status='PENDING').count()
    approved_requests = stats_base.filter(status='APPROVED').count()
    rejected_requests = stats_base.filter(status='REJECTED').count()
    total_amount = stats_base.filter(status='APPROVED').aggregate(Sum('amount'))['amount__sum'] or 0
    pending_amount = stats_base.filter(status='PENDING').aggregate(Sum('amount'))['amount__sum'] or 0
    
    # Get the latest request ID for polling
    latest_request_id = stats_base.order_by('-id').first()
    latest_id = latest_request_id.id if latest_request_id else 0
    
    my_franchise_balance = None
    my_franchise_balance_display = ''
    if not is_super_admin(effective_admin):
        try:
            fb = FranchiseBalance.objects.get(user=effective_admin)
            my_franchise_balance = fb.balance
        except FranchiseBalance.DoesNotExist:
            my_franchise_balance = 0
        from .utils import format_indian_int
        my_franchise_balance_display = format_indian_int(my_franchise_balance)
    context = get_admin_context(request, {
        'withdraw_requests': withdraw_requests_list,
        'total_requests': total_requests,
        'pending_requests': pending_requests,
        'approved_requests': approved_requests,
        'rejected_requests': rejected_requests,
        'total_amount': total_amount,
        'pending_amount': pending_amount,
        'latest_request_id': latest_id,
        'search_query': search_query,
        'status_filter': status_filter,
        'page': 'withdraw-requests',
        'my_franchise_balance': my_franchise_balance,
        'my_franchise_balance_display': my_franchise_balance_display,
    })

    return render(request, 'admin/withdraw_requests.html', context)


@admin_required
def check_new_withdraw_requests(request):
    """API endpoint to check for new withdraw requests"""
    last_id = int(request.GET.get('last_id', 0))
    effective_admin = get_effective_admin(request.user)
    new_requests = WithdrawRequest.objects.filter(id__gt=last_id, status='PENDING')
    new_requests = _scope_by_owner(new_requests, request.user, "user__worker")
    new_requests = new_requests.select_related('user').order_by('-id')[:10]
    
    requests_data = []
    for req in new_requests:
        requests_data.append({
            'id': req.id,
            'user': req.user.username,
            'amount': float(req.amount),
            'created_at': req.created_at.strftime('%Y-%m-%d %H:%M:%S'),
        })
    
    pending_qs = _scope_by_owner(
        WithdrawRequest.objects.filter(status='PENDING'), request.user, "user__worker"
    )
    return JsonResponse({
        'new_requests': requests_data,
        'latest_id': WithdrawRequest.objects.order_by('-id').first().id if WithdrawRequest.objects.exists() else last_id,
        'pending_count': pending_qs.count(),
    })

@admin_required
def approve_withdraw(request, pk):
    """Approve a withdraw request - Deducts money from wallet and sets status to COMPLETED immediately"""
    if request.method != 'POST':
        messages.error(request, 'Invalid request method. Please use the approve button.')
        return redirect('withdraw_requests')
    
    try:
        withdraw = WithdrawRequest.objects.select_related('user').get(pk=pk)
        effective_admin = get_effective_admin(request.user)
        if not _can_act_on_player(request.user, withdraw.user):
            messages.error(request, 'You can only approve withdraw requests for users in your tree.')
            return redirect('withdraw_requests')
        with db_transaction.atomic():
            withdraw = WithdrawRequest.objects.select_for_update().get(pk=pk)
            if withdraw.status != 'PENDING':
                messages.error(request, 'Withdraw request has already been processed.')
                return redirect('withdraw_requests')
            
            wallet, _ = Wallet.objects.get_or_create(user=withdraw.user)
            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
            
            if wallet.balance < withdraw.amount:
                messages.error(request, f'Insufficient balance in {withdraw.user.username}\'s wallet.')
                return redirect('withdraw_requests')

            # 1️⃣ Money is already deducted from Redis and DB during initiation
            # We just update the status to COMPLETED
            withdraw.status = 'COMPLETED'
            withdraw.processed_by = request.user
            withdraw.processed_at = timezone.now()
            
            # If there's a note or UTR from the approval process, save it
            note = request.POST.get('note', '')
            utr_number = request.POST.get('utr_number', '').strip()
            
            if note:
                withdraw.admin_note = note
            if utr_number:
                withdraw.utr_number = utr_number
                
            withdraw.save()

            # Franchise balance: credit franchise Admin wallet (Agent approvals credit parent Admin)
            if not is_super_admin(request.user):
                fa = get_franchise_admin(request.user) or request.user
                if not is_super_admin(fa):
                    fb, _ = FranchiseBalance.objects.get_or_create(user=fa, defaults={'balance': 0})
                    FranchiseBalance.objects.filter(pk=fb.pk).update(balance=F('balance') + withdraw.amount)

            logger.info(f"Withdrawal request #{withdraw.id} approved by admin {request.user.username}")
            
            # Automatically save/update bank details upon approval
            try:
                from accounts.models import UserBankDetail
                import re
                
                details_text = withdraw.withdrawal_details
                method = withdraw.withdrawal_method
                
                # Logic to extract fields from the formatted details string
                acc_name = ""
                bank_name = ""
                acc_num = ""
                ifsc = ""
                upi_id = ""
                
                if "UPI ID:" in details_text:
                    upi_match = re.search(r"UPI ID:\s*([^\n]+)", details_text)
                    name_match = re.search(r"Name:\s*([^\n]+)", details_text)
                    if upi_match: upi_id = upi_match.group(1).strip()
                    if name_match: acc_name = name_match.group(1).strip()
                else:
                    name_match = re.search(r"Name:\s*([^\n]+)", details_text)
                    bank_match = re.search(r"Bank:\s*([^\n]+)", details_text)
                    num_match = re.search(r"A/C:\s*([^\n]+)", details_text)
                    ifsc_match = re.search(r"IFSC:\s*([^\n]+)", details_text)
                    
                    if name_match: acc_name = name_match.group(1).strip()
                    if bank_match: bank_name = bank_match.group(1).strip()
                    if num_match: acc_num = num_match.group(1).strip()
                    if ifsc_match: ifsc = ifsc_match.group(1).strip()

                if acc_name and (upi_id or acc_num):
                    detail_obj = None
                    if upi_id:
                        detail_obj = UserBankDetail.objects.filter(user=withdraw.user, upi_id=upi_id).first()
                    elif acc_num:
                        detail_obj = UserBankDetail.objects.filter(user=withdraw.user, account_number=acc_num).first()
                    
                    if detail_obj:
                        detail_obj.save()
                    else:
                        UserBankDetail.objects.create(
                            user=withdraw.user,
                            account_name=acc_name,
                            bank_name=bank_name,
                            account_number=acc_num,
                            ifsc_code=ifsc,
                            upi_id=upi_id
                        )
            except Exception:
                pass
        
        messages.success(request, f'Withdraw request #{withdraw.id} approved and payment completed. ₹{withdraw.amount} deducted from {withdraw.user.username}\'s wallet.')
    except WithdrawRequest.DoesNotExist:
        messages.error(request, 'Withdraw request not found.')
    except Exception as e:
        messages.error(request, f'Error processing withdraw: {str(e)}')
    
    return redirect('withdraw_requests')

@admin_required
def complete_withdraw_payment(request, pk):
    """Finalize a withdraw request with UTR number after payment is completed"""
    if request.method != 'POST':
        messages.error(request, 'Invalid request method.')
        return redirect('withdraw_requests')
    
    utr_number = request.POST.get('utr_number', '').strip()
    if not utr_number:
        messages.error(request, 'UTR number is required to complete payment.')
        return redirect('withdraw_requests')

    try:
        withdraw = WithdrawRequest.objects.select_related('user').get(pk=pk)
        effective_admin = get_effective_admin(request.user)
        if not _can_act_on_player(request.user, withdraw.user):
            messages.error(request, 'You can only complete payments for withdraw requests from users in your tree.')
            return redirect('withdraw_requests')
        if withdraw.status != 'APPROVED':
            messages.error(request, 'Only approved requests can be marked as payment completed.')
            return redirect('withdraw_requests')
        
        withdraw.status = 'COMPLETED'
        withdraw.utr_number = utr_number
        withdraw.save()
        
        messages.success(request, f'Payment completed for withdraw request #{withdraw.id}. UTR: {utr_number}')
    except WithdrawRequest.DoesNotExist:
        messages.error(request, 'Withdraw request not found.')
    except Exception as e:
        messages.error(request, f'Error completing payment: {str(e)}')
    
    return redirect('withdraw_requests')

@admin_required
def reject_withdraw(request, pk):
    """Reject a withdraw request"""
    if request.method == 'POST':
        note = request.POST.get('note', '')
        try:
            withdraw = WithdrawRequest.objects.select_related('user').get(pk=pk)
            effective_admin = get_effective_admin(request.user)
            if not _can_act_on_player(request.user, withdraw.user):
                messages.error(request, 'You can only reject withdraw requests for users in your tree.')
                return redirect('withdraw_requests')
            with db_transaction.atomic():
                withdraw = WithdrawRequest.objects.select_for_update().get(pk=pk)
                if withdraw.status != 'PENDING':
                    messages.error(request, 'Withdraw request has already been processed.')
                    return redirect('withdraw_requests')
                
                # 1️⃣ Refund money to Redis immediately
                try:
                    from game.views import redis_client
                    if redis_client:
                        redis_client.incrbyfloat(f"user_balance:{withdraw.user.id}", float(withdraw.amount))
                        logger.info(f"Refunded Redis balance for user {withdraw.user.id} after withdrawal rejection: {withdraw.amount}")
                except Exception as re_err:
                    logger.error(f"Failed to refund Redis balance for user {withdraw.user.id}: {re_err}")

                # 2️⃣ Queue refund event to worker
                refund_event = {
                    'type': 'reject_withdraw_refund',
                    'user_id': str(withdraw.user.id),
                    'withdraw_id': str(withdraw.id),
                    'amount': str(withdraw.amount),
                    'note': note,
                    'round_id': 'WITHDRAW',
                    'timestamp': timezone.now().isoformat()
                }
                if redis_client:
                    redis_client.xadd('bet_stream', refund_event, maxlen=10000)

                withdraw.status = 'REJECTED'
                withdraw.admin_note = note
                withdraw.processed_by = request.user
                withdraw.processed_at = timezone.now()
                withdraw.save()
            
            messages.success(request, f'Withdraw request #{withdraw.id} rejected and funds refunded to user.')
        except WithdrawRequest.DoesNotExist:
            messages.error(request, 'Withdraw request not found.')
        except Exception as e:
            messages.error(request, f'Error rejecting withdraw: {str(e)}')
    
    return redirect('withdraw_requests')

def _player_ids_for_owners(owner_ids):
    """Player PKs whose worker is in owner_ids."""
    if not owner_ids:
        return []
    return list(
        User.objects.filter(is_staff=False, worker_id__in=owner_ids).values_list('id', flat=True)
    )


def _all_player_ids():
    return list(User.objects.filter(is_staff=False).values_list('id', flat=True))


def _unowned_player_ids():
    """Players not assigned to any admin/agent (house-operated)."""
    return list(
        User.objects.filter(is_staff=False, worker_id__isnull=True).values_list('id', flat=True)
    )


def _float_metrics_for_players(admin_user, franchise_name, current_balance, player_ids, from_date, to_date, agent_count=0):
    topups, set_logs = _franchise_topups(admin_user, from_date, to_date) if admin_user else (0, [])
    deposits = _sum_approved_deposits(player_ids, from_date, to_date)
    withdraws = _sum_withdraw_credits(player_ids, from_date, to_date)
    try:
        deposits_i = int(deposits)
    except Exception:
        deposits_i = int(float(deposits or 0))
    try:
        withdraws_i = int(withdraws)
    except Exception:
        withdraws_i = int(float(withdraws or 0))
    topups_i = int(topups or 0)
    return {
        'admin_id': getattr(admin_user, 'id', None),
        'admin_username': getattr(admin_user, 'username', None) or '—',
        'franchise_name': franchise_name,
        'current_balance': int(current_balance or 0),
        'topups': topups_i,
        'set_logs_count': len(set_logs),
        'deposit_deductions': deposits_i,
        'withdraw_credits': withdraws_i,
        'net_float_change': topups_i - deposits_i + withdraws_i,
        'player_count': len(player_ids),
        'agent_count': agent_count,
    }


def _sum_approved_deposits(player_ids, from_date=None, to_date=None):
    if not player_ids:
        return 0
    qs = DepositRequest.objects.filter(user_id__in=player_ids, status='APPROVED')
    # Prefer processed_at; fall back to created_at when null
    if from_date is not None:
        qs = qs.filter(
            Q(processed_at__date__gte=from_date) |
            Q(processed_at__isnull=True, created_at__date__gte=from_date)
        )
    if to_date is not None:
        qs = qs.filter(
            Q(processed_at__date__lte=to_date) |
            Q(processed_at__isnull=True, created_at__date__lte=to_date)
        )
    auto_qs = AutoDepositTransaction.objects.filter(user_id__in=player_ids, status='CREDITED')
    if from_date is not None:
        auto_qs = auto_qs.filter(payment_time__date__gte=from_date)
    if to_date is not None:
        auto_qs = auto_qs.filter(payment_time__date__lte=to_date)
    manual = qs.aggregate(s=Sum('amount'))['s'] or 0
    auto = auto_qs.aggregate(s=Sum('amount'))['s'] or 0
    try:
        return int(manual) + int(auto)
    except Exception:
        return float(manual) + float(auto)


def _has_field(model, name):
    try:
        model._meta.get_field(name)
        return True
    except Exception:
        return False


def _sum_withdraw_credits(player_ids, from_date=None, to_date=None):
    """Franchise float goes up when withdraw is approved/completed."""
    if not player_ids:
        return 0
    qs = WithdrawRequest.objects.filter(user_id__in=player_ids, status__in=['APPROVED', 'COMPLETED'])
    if from_date is not None:
        qs = qs.filter(
            Q(processed_at__date__gte=from_date) |
            Q(processed_at__isnull=True, created_at__date__gte=from_date)
        )
    if to_date is not None:
        qs = qs.filter(
            Q(processed_at__date__lte=to_date) |
            Q(processed_at__isnull=True, created_at__date__lte=to_date)
        )
    return qs.aggregate(s=Sum('amount'))['s'] or 0


def _sum_tx_types(player_ids, types, from_date=None, to_date=None):
    if not player_ids:
        return 0
    qs = Transaction.objects.filter(user_id__in=player_ids, transaction_type__in=types)
    if from_date is not None:
        qs = qs.filter(created_at__date__gte=from_date)
    if to_date is not None:
        qs = qs.filter(created_at__date__lte=to_date)
    # Use absolute sum of positive amounts for bets/wins; deposits may be negative for admin adjustments
    total = 0
    for row in qs.values_list('amount', flat=True):
        try:
            v = float(row or 0)
        except Exception:
            v = 0
        if 'BET' in types or 'WIN' in types or 'WITHDRAW' in types:
            total += abs(v)
        else:
            # DEPOSIT: count positive credits only
            if v > 0:
                total += v
    return total


def _franchise_topups(franchise_admin, from_date=None, to_date=None):
    qs = FranchiseBalanceLog.objects.filter(user=franchise_admin)
    if from_date is not None:
        qs = qs.filter(created_at__date__gte=from_date)
    if to_date is not None:
        qs = qs.filter(created_at__date__lte=to_date)
    add_total = qs.filter(action=FranchiseBalanceLog.ACTION_ADD).aggregate(s=Sum('amount'))['s'] or 0
    set_logs = list(qs.filter(action=FranchiseBalanceLog.ACTION_SET).order_by('-created_at')[:50])
    return int(add_total), set_logs


def build_franchise_float_rows(viewer, from_date=None, to_date=None, franchise_id=None):
    """
    Rows for franchise float report.
    God: every franchise (or one if franchise_id).
    Super Admin: franchises inside its own subtree, plus its own direct players.
    Franchise Admin: self only.
    Agent: none (float is on parent admin).
    """
    rows = []
    if is_agent(viewer) and not is_franchise_admin(viewer) and not is_super_admin(viewer):
        return rows

    franchises = []  # list of (admin_user, franchise_name, current_balance)

    if is_super_admin(viewer):
        fb_map = {
            fb.user_id: fb
            for fb in FranchiseBalance.objects.select_related('user').all()
        }
        # Include franchise admins even if FranchiseBalance row is missing
        admin_qs = visible_staff_qs(viewer).exclude(is_superuser=True)
        # Prefer ROLE_ADMIN / is_franchise_only; also anyone who has agents or FB row
        candidates = []
        for u in admin_qs.order_by('username'):
            if franchise_id and u.id != franchise_id:
                continue
            if u.id in fb_map or is_franchise_admin(u) or getattr(u, 'is_franchise_only', False) or getattr(u, 'staff_role', None) == 'ADMIN':
                candidates.append(u)
            elif agent_ids_under_admin(u):
                candidates.append(u)
        # If still empty and franchise_id set, include that user
        if not candidates and franchise_id:
            try:
                candidates = [visible_staff_qs(viewer).get(pk=franchise_id)]
            except User.DoesNotExist:
                candidates = []
        # Deduplicate
        seen = set()
        for u in candidates:
            if u.id in seen:
                continue
            seen.add(u.id)
            fb = fb_map.get(u.id)
            franchises.append((
                u,
                (fb.franchise_name if fb and fb.franchise_name else u.username),
                int(fb.balance) if fb else 0,
            ))
    else:
        fa = get_franchise_admin(viewer) or viewer
        if franchise_id and fa.id != franchise_id and is_super_admin(viewer):
            pass
        try:
            fb = FranchiseBalance.objects.select_related('user').get(user=fa)
            franchises.append((fa, fb.franchise_name or fa.username, int(fb.balance or 0)))
        except FranchiseBalance.DoesNotExist:
            franchises.append((fa, fa.username, 0))

    for admin_user, franchise_name, current_balance in franchises:
        owner_ids = [admin_user.id] + list(agent_ids_under_admin(admin_user))
        player_ids = _player_ids_for_owners(owner_ids)
        rows.append(_float_metrics_for_players(
            admin_user, franchise_name, current_balance, player_ids, from_date, to_date,
            agent_count=len(owner_ids) - 1,
        ))

    if is_super_admin(viewer) and not franchise_id:
        if sees_all_data(viewer):
            # God: unassigned players, or the whole house before any franchise exists
            if franchises:
                unowned = _unowned_player_ids()
                if unowned:
                    rows.append(_float_metrics_for_players(
                        None, 'House (Unassigned)', 0, unowned, from_date, to_date, agent_count=0,
                    ))
            else:
                rows.append(_float_metrics_for_players(
                    None, 'House (All players)', 0, _all_player_ids(), from_date, to_date, agent_count=0,
                ))
        else:
            # Super Admin: only the players it owns directly, never the house
            direct = _player_ids_for_owners([viewer.id])
            if direct:
                rows.append(_float_metrics_for_players(
                    None, 'Direct (my players)', 0, direct, from_date, to_date, agent_count=0,
                ))
    return rows


def build_agent_commission_rows(viewer, from_date=None, to_date=None, franchise_id=None):
    """
    Per-agent performance / commission-style summary under a franchise.
    Includes a Direct row for players owned by the franchise admin.
    God with no franchise selected: House (all / unassigned) summary.
    """
    rows = []
    house_mode = False
    franchise_admin = None

    if is_super_admin(viewer):
        if franchise_id:
            try:
                franchise_admin = visible_staff_qs(viewer).get(pk=franchise_id)
            except User.DoesNotExist:
                return rows
        elif sees_all_data(viewer):
            house_mode = True
        else:
            # Super Admin rolls up its own tree rather than the whole house
            franchise_admin = viewer
    elif is_franchise_admin(viewer):
        franchise_admin = viewer
    elif is_agent(viewer):
        franchise_admin = get_franchise_admin(viewer) or viewer
    else:
        return rows

    def _row(label, pids, is_direct=False, agent_user=None):
        deposits = _sum_approved_deposits(pids, from_date, to_date)
        withdraws = _sum_withdraw_credits(pids, from_date, to_date)
        bets = _sum_tx_types(pids, ['BET'], from_date, to_date)
        wins = _sum_tx_types(pids, ['WIN'], from_date, to_date)
        try:
            dep_i = int(deposits)
        except Exception:
            dep_i = int(float(deposits or 0))
        try:
            wdr_i = int(withdraws)
        except Exception:
            wdr_i = int(float(withdraws or 0))
        net_cash = dep_i - wdr_i
        house_pl = float(bets) - float(wins)
        return {
            'label': label,
            'username': getattr(agent_user, 'username', None) or label,
            'agent_id': getattr(agent_user, 'id', None),
            'is_direct': is_direct,
            'player_count': len(pids),
            'deposits': dep_i,
            'withdraws': wdr_i,
            'net_cash': net_cash,
            'bets': float(bets),
            'wins': float(wins),
            'house_pl': house_pl,
        }

    if house_mode:
        # No franchise filter: commission-style house rollup (useful before franchises exist)
        has_franchises = (
            FranchiseBalance.objects.exists()
            or User.objects.filter(is_staff=True, staff_role='ADMIN').exclude(is_superuser=True).exists()
            or User.objects.filter(is_staff=True, is_franchise_only=True).exclude(is_superuser=True).exists()
        )
        pids = _unowned_player_ids() if has_franchises else _all_player_ids()
        label = 'House (Unassigned)' if has_franchises else 'House (All players)'
        rows.append(_row(label, pids, is_direct=True))
    else:
        # Agents under this franchise (+ optional single agent view)
        if is_agent(viewer) and not is_franchise_admin(viewer) and not is_super_admin(viewer):
            agents = [viewer]
            include_direct = False
        else:
            agents = list(
                User.objects.filter(is_staff=True, works_under_id=franchise_admin.id).order_by('username')
            )
            include_direct = True

        if include_direct:
            rows.append(_row(
                'Direct (Admin players)',
                _player_ids_for_owners([franchise_admin.id]),
                is_direct=True,
                agent_user=franchise_admin,
            ))

        for ag in agents:
            rows.append(_row(ag.username, _player_ids_for_owners([ag.id]), is_direct=False, agent_user=ag))

    # Totals row
    if rows:
        rows.append({
            'label': 'TOTAL',
            'username': 'TOTAL',
            'agent_id': None,
            'is_direct': False,
            'is_total': True,
            'player_count': sum(r['player_count'] for r in rows),
            'deposits': sum(r['deposits'] for r in rows),
            'withdraws': sum(r['withdraws'] for r in rows),
            'net_cash': sum(r['net_cash'] for r in rows),
            'bets': sum(r['bets'] for r in rows),
            'wins': sum(r['wins'] for r in rows),
            'house_pl': sum(r['house_pl'] for r in rows),
        })
    return rows


@admin_required
def transactions(request):
    """Reports page showing financial summary. Franchise owners see only transactions of players under their franchise."""
    if not has_menu_permission(request.user, 'transactions'):
        messages.error(request, 'You do not have permission to view reports.')
        return redirect('admin_dashboard')

    from datetime import timedelta
    from django.db.models.functions import TruncDate

    effective_admin = get_effective_admin(request.user)
    transactions_query = Transaction.objects.all()
    transactions_query = _scope_by_owner(transactions_query, request.user, "user__worker")

    # Get filters: search and optional date range. Default = last 7 days when no params; overall=1 = all time.
    search_query = request.GET.get('search', '').strip()
    from_date_str = request.GET.get('from_date', '').strip()
    to_date_str = request.GET.get('to_date', '').strip()
    show_overall = request.GET.get('overall', '').strip().lower() in ('1', 'true', 'yes')
    try:
        franchise_id = int(request.GET.get('franchise_id') or 0) or None
    except (TypeError, ValueError):
        franchise_id = None

    today = timezone.now().date()
    from_date = None
    to_date = None

    if from_date_str:
        try:
            from_date = _dt.datetime.strptime(from_date_str, '%Y-%m-%d').date()
        except ValueError:
            from_date = None
    if to_date_str:
        try:
            to_date = _dt.datetime.strptime(to_date_str, '%Y-%m-%d').date()
        except ValueError:
            to_date = None

    # Default: when no date params and not "overall", use last 7 days
    if not show_overall and from_date is None and to_date is None:
        from_date = today - timedelta(days=6)  # 7 days inclusive
        to_date = today
        from_date_str = from_date.strftime('%Y-%m-%d')
        to_date_str = to_date.strftime('%Y-%m-%d')

    if from_date is not None:
        transactions_query = transactions_query.filter(created_at__date__gte=from_date)
    if to_date is not None:
        transactions_query = transactions_query.filter(created_at__date__lte=to_date)

    date_filter_applied = from_date is not None or to_date is not None

    # Apply search filter (filter by user)
    if search_query:
        transactions_query = transactions_query.filter(
            Q(user__username__icontains=search_query) |
            Q(user__phone_number__icontains=search_query)
        )

    # Calculate stats from (possibly filtered) queryset
    total_transactions = transactions_query.count()
    total_deposits = transactions_query.filter(transaction_type='DEPOSIT').aggregate(Sum('amount'))['amount__sum'] or 0
    total_withdraws = transactions_query.filter(transaction_type='WITHDRAW').aggregate(Sum('amount'))['amount__sum'] or 0
    total_bets = transactions_query.filter(transaction_type='BET').aggregate(Sum('amount'))['amount__sum'] or 0
    total_wins = transactions_query.filter(transaction_type='WIN').aggregate(Sum('amount'))['amount__sum'] or 0
    admin_profit = total_bets - total_wins

    # Chart series for selected range (cap at 90 days for readability)
    if date_filter_applied and from_date is not None and to_date is not None:
        chart_start = from_date
        chart_end = to_date
        if (chart_end - chart_start).days > 90:
            chart_end = chart_start + timedelta(days=90)
    else:
        chart_end = timezone.now().date()
        chart_start = chart_end - timedelta(days=29)

    daily_stats = transactions_query.filter(
        created_at__date__gte=chart_start,
        created_at__date__lte=chart_end,
        transaction_type__in=['BET', 'WIN', 'DEPOSIT', 'WITHDRAW'],
    ).annotate(
        date=TruncDate('created_at')
    ).values('date', 'transaction_type').annotate(
        daily_amount=Sum('amount')
    ).order_by('date')

    empty_day = {
        'deposit': 0.0,
        'withdraw': 0.0,
        'bet': 0.0,
        'win': 0.0,
        'profit': 0.0,
    }
    day_map = {}
    d = chart_start
    while d <= chart_end:
        day_map[d] = dict(empty_day)
        d += timedelta(days=1)

    for stat in daily_stats:
        date = stat['date']
        if date not in day_map:
            continue
        amount = abs(float(stat['daily_amount'] or 0))
        t = stat['transaction_type']
        if t == 'DEPOSIT':
            day_map[date]['deposit'] += amount
        elif t == 'WITHDRAW':
            day_map[date]['withdraw'] += amount
        elif t == 'BET':
            day_map[date]['bet'] += amount
            day_map[date]['profit'] += amount
        elif t == 'WIN':
            day_map[date]['win'] += amount
            day_map[date]['profit'] -= amount

    sorted_dates = sorted(day_map.keys())
    chart_labels = [date.strftime('%d %b') for date in sorted_dates]
    chart_profit = [round(day_map[date]['profit'], 2) for date in sorted_dates]
    chart_deposits = [round(day_map[date]['deposit'], 2) for date in sorted_dates]
    chart_withdraws = [round(day_map[date]['withdraw'], 2) for date in sorted_dates]
    chart_bets = [round(day_map[date]['bet'], 2) for date in sorted_dates]
    chart_wins = [round(day_map[date]['win'], 2) for date in sorted_dates]
    # Keep old key for any leftover template refs
    chart_data = chart_profit

    chart_range_label = f"{chart_start.strftime('%d %b %Y')} – {chart_end.strftime('%d %b %Y')}"

    is_franchise_scope = not is_super_admin(effective_admin)

    # Franchise float + agent commission reports
    franchise_options = []
    if is_super_admin(request.user):
        # Prefer FranchiseBalance rows; fall back to franchise admin users
        fb_list = list(
            FranchiseBalance.objects.select_related('user').order_by('franchise_name', 'user__username')
        )
        if fb_list:
            franchise_options = fb_list
        else:
            # Synthetic options for template (need .user_id, .franchise_name, .user.username)
            class _Opt:
                def __init__(self, u):
                    self.user = u
                    self.user_id = u.id
                    self.franchise_name = u.username
            for u in User.objects.filter(is_staff=True).exclude(is_superuser=True).order_by('username'):
                if is_franchise_admin(u) or getattr(u, 'is_franchise_only', False) or getattr(u, 'staff_role', None) == 'ADMIN' or agent_ids_under_admin(u):
                    franchise_options.append(_Opt(u))
        if not franchise_id and franchise_options:
            franchise_id = franchise_options[0].user_id

    float_rows = build_franchise_float_rows(
        request.user, from_date=from_date, to_date=to_date, franchise_id=None
    )
    agent_rows = build_agent_commission_rows(
        request.user, from_date=from_date, to_date=to_date, franchise_id=franchise_id
    )
    selected_franchise_name = None
    if franchise_id:
        for fb in franchise_options:
            if fb.user_id == franchise_id:
                selected_franchise_name = fb.franchise_name or fb.user.username
                break
        if not selected_franchise_name and not is_super_admin(request.user):
            fa = get_franchise_admin(request.user) or request.user
            selected_franchise_name = getattr(fa, 'username', '')
    elif is_super_admin(request.user) and not franchise_options:
        selected_franchise_name = 'House'

    context = get_admin_context(request, {
        'total_transactions': total_transactions,
        'total_deposits': total_deposits,
        'total_withdraws': total_withdraws,
        'total_bets': total_bets,
        'total_wins': total_wins,
        'admin_profit': admin_profit,
        'chart_labels': json.dumps(chart_labels),
        'chart_data': json.dumps(chart_data),
        'chart_profit': json.dumps(chart_profit),
        'chart_deposits': json.dumps(chart_deposits),
        'chart_withdraws': json.dumps(chart_withdraws),
        'chart_bets': json.dumps(chart_bets),
        'chart_wins': json.dumps(chart_wins),
        'chart_range_label': chart_range_label,
        'search_query': search_query,
        'from_date': from_date_str,
        'to_date': to_date_str,
        'date_filter_applied': date_filter_applied,
        'page': 'transactions',
        'is_franchise_scope': is_franchise_scope,
        'scope_label': 'Your franchise' if is_franchise_scope else None,
        'float_rows': float_rows,
        'agent_rows': agent_rows,
        'franchise_options': franchise_options,
        'selected_franchise_id': franchise_id,
        'selected_franchise_name': selected_franchise_name,
        'show_overall': show_overall,
    })

    return render(request, 'admin/transactions.html', context)

@super_admin_required
@admin_required
def admin_management(request):
    """Worker Management temporarily disabled — redirect to Agents / Franchise."""
    messages.info(request, 'Worker Management is disabled. Use Agent Management and Franchise (Admins) instead.')
    return redirect('agent_management')



@super_admin_required
@require_POST
def toggle_admin_status(request, admin_id):
    """Activate or deactivate an admin. Cannot deactivate yourself or the last superuser."""
    try:
        user = visible_staff_qs(request.user).get(id=admin_id)
    except User.DoesNotExist:
        messages.error(request, 'Worker not found.')
        return redirect('admin_management')
    if user.id == request.user.id:
        messages.error(request, 'You cannot deactivate your own account.')
        return redirect('admin_management')
    if user.is_superuser and User.objects.filter(is_staff=True, is_superuser=True, is_active=True).count() <= 1:
        messages.error(request, 'Cannot deactivate the last active Super Admin.')
        return redirect('admin_management')
    user.is_active = not user.is_active
    user.save()
    status = 'activated' if user.is_active else 'deactivated'
    messages.success(request, f'Worker "{user.username}" has been {status}.')
    next_status = request.POST.get('status') or request.GET.get('status', 'all')
    return redirect('admin_management' + ('?status=' + next_status if next_status != 'all' else ''))


@super_admin_required
def franchise_balance(request):
    """Franchise balance management - Super Admin only. List admins and allocate/top-up balance."""
    if not is_super_admin(request.user):
        messages.error(request, 'Only Super Admins can manage Franchise Balance.')
        return redirect('admin_dashboard')
    
    # POST: add/set balance or save franchise name
    if request.method == 'POST':
        admin_id = request.POST.get('admin_id')
        action = request.POST.get('action', 'add')  # 'add', 'set', or 'save_name'
        try:
            admin_user = visible_staff_qs(request.user).get(pk=admin_id)
        except User.DoesNotExist:
            messages.error(request, 'Worker not found.')
            return redirect('franchise_balance')
        if action == 'save_name':
            franchise_name = request.POST.get('franchise_name', '').strip()[:120]
            with db_transaction.atomic():
                fb, _ = FranchiseBalance.objects.get_or_create(user=admin_user, defaults={'balance': 0})
                fb.franchise_name = franchise_name
                fb.save()
            messages.success(request, f"Franchise name for {admin_user.username} set to '{franchise_name or '(empty)'}'.")
            return redirect('franchise_balance')
        if action == 'deactivate_franchise_admin':
            if admin_user.id == request.user.id:
                messages.error(request, 'You cannot deactivate your own account.')
                return redirect('franchise_balance')
            if admin_user.is_superuser:
                messages.error(request, 'Super Admin accounts cannot be deactivated from here.')
                return redirect('franchise_balance')
            with db_transaction.atomic():
                player_count = User.objects.filter(worker=admin_user, is_staff=False).count()
                User.objects.filter(worker=admin_user, is_staff=False).update(worker=request.user)
                admin_user.is_active = False
                admin_user.save()
            messages.success(request, f'"{admin_user.username}" deactivated. {player_count} player(s) reassigned to you (Super Admin).')
            return redirect('franchise_balance')
        if action == 'activate_franchise_admin':
            if admin_user.is_superuser:
                messages.error(request, 'Super Admin is always active.')
                return redirect('franchise_balance')
            admin_user.is_active = True
            admin_user.save()
            messages.success(request, f'"{admin_user.username}" activated.')
            return redirect('franchise_balance')
        if action in ('add', 'set') and not admin_user.is_active:
            messages.error(request, f'Cannot add or set balance for inactive franchise "{admin_user.username}". Activate them first from their details page.')
            return redirect('franchise_balance')
        amount_str = request.POST.get('amount', '').strip()
        try:
            amount = int(amount_str)
            if amount < 0:
                raise ValueError('Amount must be non-negative')
        except (ValueError, TypeError):
            messages.error(request, 'Enter a valid amount (whole number).')
            return redirect('franchise_balance')
        with db_transaction.atomic():
            fb, _ = FranchiseBalance.objects.get_or_create(user=admin_user, defaults={'balance': 0})
            if action == 'set':
                fb.balance = amount
                fb.save()
                balance_after = amount
                FranchiseBalanceLog.objects.create(
                    user=admin_user,
                    action=FranchiseBalanceLog.ACTION_SET,
                    amount=amount,
                    balance_after=balance_after,
                    performed_by=request.user,
                )
            else:
                balance_before = fb.balance
                FranchiseBalance.objects.filter(pk=fb.pk).update(balance=F('balance') + amount)
                FranchiseBalanceLog.objects.create(
                    user=admin_user,
                    action=FranchiseBalanceLog.ACTION_ADD,
                    amount=amount,
                    balance_after=balance_before + amount,
                    performed_by=request.user,
                )
        if action == 'set':
            messages.success(request, f"Franchise balance for {admin_user.username} set to ₹{amount:,}.")
        else:
            messages.success(request, f"Added ₹{amount:,} to {admin_user.username}'s franchise balance.")
        return redirect('franchise_balance')
    
    # GET: list Admins (franchise) + Super Admins in the viewer's own subtree — not
    # Agents, and never God
    admin_users = visible_staff_qs(
        request.user,
        User.objects.filter(is_staff=True).filter(
            Q(is_superuser=True) | Q(staff_role=User.ROLE_ADMIN) | Q(is_franchise_only=True)
        ).exclude(staff_role=User.ROLE_AGENT),
    ).order_by('-is_active', 'username')
    admin_list = []
    for user in admin_users:
        try:
            fb = FranchiseBalance.objects.get(user=user)
        except FranchiseBalance.DoesNotExist:
            fb = None
        admin_list.append({
            'user': user,
            'balance': fb.balance if fb else 0,
            'franchise_name': fb.franchise_name if fb else '',
            'is_superuser': user.is_superuser,
        })
    
    context = get_admin_context(request, {
        'page': 'franchise-balance',
        'admin_list': admin_list,
    })
    return render(request, 'admin/franchise_balance.html', context)


def _get_queue_owners(actor=None):
    """
    Admins a worker can be assigned to (Super Admins + franchise admins), limited
    to the actor's own subtree. God is never an owner — nothing may sit directly
    under the God account.
    """
    scope = visible_staff_qs(actor) if actor is not None else User.objects.filter(is_staff=True)
    owners = []
    for u in scope.filter(is_superuser=True).exclude(
        staff_role=User.ROLE_GOD
    ).order_by('username'):
        owners.append({'id': u.id, 'label': f'{u.username} (Super Admin)'})
    franchise_ids = FranchiseBalance.objects.values_list('user_id', flat=True).distinct()
    for u in scope.filter(id__in=franchise_ids).exclude(is_superuser=True).order_by('username'):
        owners.append({'id': u.id, 'label': u.username})
    return owners


@super_admin_required
def create_admin(request):
    """Create a new admin user with permissions"""
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')
        password2 = (request.POST.get('password2') or request.POST.get('confirm_password') or '')
        
        # Get permission checkboxes
        permissions = {
            'can_view_dashboard': request.POST.get('can_view_dashboard') == 'on',
            'can_control_dice': request.POST.get('can_control_dice') == 'on',
            'can_view_recent_rounds': request.POST.get('can_view_recent_rounds') == 'on',
            'can_view_all_bets': request.POST.get('can_view_all_bets') == 'on',
            'can_view_wallets': request.POST.get('can_view_wallets') == 'on',
            'can_view_players': request.POST.get('can_view_players') == 'on',
            'can_view_deposit_requests': request.POST.get('can_view_deposit_requests') == 'on',
            'can_view_withdraw_requests': request.POST.get('can_view_withdraw_requests') == 'on',
            'can_view_transactions': request.POST.get('can_view_transactions') == 'on',
            'can_view_game_history': request.POST.get('can_view_game_history', 'on') == 'on',
            'can_view_game_settings': request.POST.get('can_view_game_settings') == 'on',
            'can_view_help_center': request.POST.get('can_view_help_center') == 'on',
            'can_view_white_label': request.POST.get('can_view_white_label') == 'on',
            'can_view_admin_management': request.POST.get('can_view_admin_management') == 'on',
            'can_manage_payment_methods': request.POST.get('can_manage_payment_methods') == 'on',
        }
        
        # Validation
        if not username or not password:
            messages.error(request, 'Username and password are required.')
            return render(request, 'admin/create_admin.html', {'permissions': permissions, 'queue_owners': _get_queue_owners(request.user)})
        
        if password != password2:
            messages.error(request, 'Passwords do not match.')
            return render(request, 'admin/create_admin.html', {'permissions': permissions, 'queue_owners': _get_queue_owners(request.user)})

        if len(password) < 4:
            messages.error(request, 'Password must be at least 4 characters long.')
            return render(request, 'admin/create_admin.html', {'permissions': permissions, 'queue_owners': _get_queue_owners(request.user)})
        
        if User.objects.filter(username=username).exists():
            messages.error(request, 'Username already exists.')
            return render(request, 'admin/create_admin.html', {'permissions': permissions, 'queue_owners': _get_queue_owners(request.user)})
        
        try:
            # Create user with is_staff=True but is_superuser=False
            email = f"{username}@gundu.ata"
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password,
                is_staff=True,
                is_superuser=False,
                is_active=True
            )
            
            # Create permissions
            AdminPermissions.objects.create(user=user, **permissions)
            invalidate_admin_permissions_cache(user)
            works_under_id = request.POST.get('works_under_id', '').strip()
            if works_under_id:
                try:
                    admin_user = visible_staff_qs(request.user).get(pk=int(works_under_id))
                    if admin_user.id != user.id:
                        user.works_under = admin_user
                        user.save(update_fields=['works_under_id'])
                except (ValueError, User.DoesNotExist):
                    pass
            password_auto_generated = request.POST.get('password_auto_generated', 'false') == 'true'
            if password_auto_generated:
                messages.success(request, f'🎉 Admin user "{username}" created successfully! 🔐 Generated Password: <strong style="font-family: monospace; background: #f0fdf4; padding: 4px 8px; border-radius: 4px; color: #166534;">{password}</strong><br><small style="color: #666;">⚠️ Save this password securely - it will only be shown once!</small>')
            else:
                messages.success(request, f'Admin user "{username}" created successfully!')
            return redirect('admin_management')
        except Exception as e:
            messages.error(request, f'Error creating admin: {str(e)}')
            return render(request, 'admin/create_admin.html', {'permissions': permissions, 'queue_owners': _get_queue_owners(request.user)})
    
    return render(request, 'admin/create_admin.html', {'queue_owners': _get_queue_owners(request.user)})


@super_admin_required
def franchise_admin_details(request, admin_id):
    """Franchise owner user info only: username, balance, stats, balance history, franchise name. No menu permissions."""
    try:
        user = visible_staff_qs(request.user).get(id=admin_id)
    except User.DoesNotExist:
        messages.error(request, 'Franchise admin not found.')
        return redirect('franchise_balance')
    try:
        fb = FranchiseBalance.objects.get(user=user)
        franchise_name = fb.franchise_name or ''
        balance = fb.balance
        package_name = fb.package_name or ''
        help_whatsapp_number = fb.help_whatsapp_number or ''
        help_telegram = fb.help_telegram or ''
    except FranchiseBalance.DoesNotExist:
        franchise_name = ''
        balance = 0
        package_name = ''
        help_whatsapp_number = ''
        help_telegram = ''
    form_username = None
    if request.method == 'POST':
        action = request.POST.get('action', '').strip()
        if action == 'change_password':
            if user.is_superuser:
                messages.error(request, 'Super Admin password cannot be changed from this page.')
            else:
                new_password = (request.POST.get('new_password') or '').strip()
                new_password_confirm = (request.POST.get('new_password_confirm') or '').strip()
                if not new_password:
                    messages.error(request, 'New password is required.')
                elif len(new_password) < 4:
                    messages.error(request, 'Password must be at least 4 characters.')
                elif new_password != new_password_confirm:
                    messages.error(request, 'Passwords do not match.')
                else:
                    user.set_password(new_password)
                    user.save()
                    messages.success(request, f'Password updated for "{user.username}".')
            return redirect('franchise_admin_details', admin_id=user.id)
        if action == 'assign_player':
            # Assign an existing player (by phone or username) to this franchise admin
            raw_input = (request.POST.get('assign_phone') or '').strip()
            if not raw_input:
                messages.error(request, 'Please enter a phone number or username.')
            else:
                from accounts.sms_service import sms_service
                player = None
                clean_phone = sms_service._clean_phone_number(raw_input, for_sms=False)
                player = User.objects.filter(
                    Q(phone_number=clean_phone) | Q(phone_number=raw_input)
                ).filter(is_staff=False, is_superuser=False).first()
                if not player:
                    digits = ''.join(c for c in raw_input if c.isdigit())
                    if digits:
                        player = (
                            User.objects.filter(phone_number=digits).filter(is_staff=False, is_superuser=False).first()
                            or User.objects.filter(phone_number__endswith=digits[-10:] if len(digits) >= 10 else digits).filter(is_staff=False, is_superuser=False).first()
                        )
                if not player:
                    player = User.objects.filter(username__iexact=raw_input).filter(is_staff=False, is_superuser=False).first()
                if not player:
                    messages.error(request, f'No player found with phone or username "{raw_input}".')
                elif player.worker_id == user.id:
                    messages.info(request, f'"{player.username}" is already under this franchise.')
                else:
                    old_worker = getattr(player.worker, 'username', None) or 'Super Admin'
                    player.worker = user
                    player.save(update_fields=['worker_id'])
                    messages.success(request, f'"{player.username}" assigned to this franchise. (Was under {old_worker})')
            return redirect('franchise_admin_details', admin_id=user.id)
        if action == 'deactivate_franchise_admin':
            if user.id == request.user.id:
                messages.error(request, 'You cannot deactivate your own account.')
            elif user.is_superuser:
                messages.error(request, 'Super Admin accounts cannot be deactivated from here.')
            else:
                with db_transaction.atomic():
                    player_count = User.objects.filter(worker=user, is_staff=False).count()
                    User.objects.filter(worker=user, is_staff=False).update(worker=request.user)
                    user.is_active = False
                    user.save()
                messages.success(request, f'"{user.username}" deactivated. {player_count} player(s) reassigned to you (Super Admin).')
            return redirect('franchise_admin_details', admin_id=user.id)
        if action == 'activate_franchise_admin':
            if user.is_superuser:
                messages.success(request, 'Super Admin is always active.')
            else:
                user.is_active = True
                user.save()
                messages.success(request, f'"{user.username}" activated.')
            return redirect('franchise_admin_details', admin_id=user.id)
        # save_settings or empty: save username + Help Center (package name, WhatsApp, Telegram)
        new_username = (request.POST.get('username') or '').strip()
        updated = []
        has_error = False
        if new_username != user.username:
            if not new_username:
                messages.error(request, 'Username cannot be empty.')
                has_error = True
            elif User.objects.filter(username=new_username).exclude(pk=user.pk).exists():
                messages.error(request, f'Username "{new_username}" is already taken.')
                has_error = True
            else:
                user.username = new_username
                user.save()
                updated.append('username')
        if has_error:
            form_username = new_username
        else:
            if updated:
                messages.success(request, 'Username updated.')
            # Save Help Center package name only (WhatsApp/Telegram are set by franchise on Help Center page)
            fb, _ = FranchiseBalance.objects.get_or_create(user=user, defaults={'balance': 0})
            pkg = (request.POST.get('package_name') or '').strip()[:255]
            help_saved = False
            duplicate_pkg = False
            if pkg != (fb.package_name or ''):
                if pkg and FranchiseBalance.objects.filter(package_name=pkg).exclude(user=user).exists():
                    messages.error(request, f'Package name "{pkg}" is already used by another franchise.')
                    package_name = pkg
                    duplicate_pkg = True
                else:
                    fb.package_name = pkg or None
                    fb.save()
                    help_saved = True
                    if not updated:
                        messages.success(request, 'Package name saved.')
            if updated or help_saved:
                return redirect('franchise_admin_details', admin_id=user.id)
        # Re-read help fields for display after POST (keep form values when duplicate_pkg error was shown)
        if request.method == 'POST' and not duplicate_pkg:
            try:
                fb = FranchiseBalance.objects.get(user=user)
                package_name = fb.package_name or ''
                help_whatsapp_number = fb.help_whatsapp_number or ''
                help_telegram = fb.help_telegram or ''
            except FranchiseBalance.DoesNotExist:
                package_name = help_whatsapp_number = help_telegram = ''
    # Agents under this Admin + player ownership tree
    agents_qs = User.objects.filter(
        is_staff=True, works_under=user, is_superuser=False,
    ).filter(
        Q(staff_role=User.ROLE_AGENT) | Q(is_franchise_only=False)
    ).exclude(staff_role=User.ROLE_ADMIN).order_by('-is_active', 'username')
    agent_rows = []
    agent_ids = []
    for agent in agents_qs:
        agent_ids.append(agent.id)
        agent_rows.append({
            'user': agent,
            'player_count': User.objects.filter(worker=agent, is_staff=False).count(),
            'referral_code': agent.referral_code or '',
        })
    owner_ids = [user.id] + agent_ids
    direct_clients_count = User.objects.filter(worker=user, is_staff=False).count()
    clients_count = User.objects.filter(worker_id__in=owner_ids, is_staff=False).count()
    total_deposits = (
        DepositRequest.objects.filter(user__worker_id__in=owner_ids, status='APPROVED')
        .aggregate(s=Coalesce(Sum('amount'), 0))['s'] or 0
    )
    total_withdrawals = (
        WithdrawRequest.objects.filter(
            user__worker_id__in=owner_ids,
            status__in=['APPROVED', 'COMPLETED'],
        ).aggregate(s=Coalesce(Sum('amount'), 0))['s'] or 0
    )
    segment_profit = total_deposits - total_withdrawals
    balance_logs = FranchiseBalanceLog.objects.filter(user=user).select_related('performed_by').order_by('-created_at')[:200]
    context = get_admin_context(request, {
        'admin_user': user,
        'franchise_name': franchise_name,
        'balance': balance,
        'page': 'franchise-balance',
        'clients_count': clients_count,
        'direct_clients_count': direct_clients_count,
        'agents_count': len(agent_rows),
        'agent_rows': agent_rows,
        'total_deposits': total_deposits,
        'total_withdrawals': total_withdrawals,
        'segment_profit': segment_profit,
        'balance_logs': balance_logs,
        'package_name': package_name,
        'help_whatsapp_number': help_whatsapp_number,
        'help_telegram': help_telegram,
    })
    if form_username is not None:
        context['form_username'] = form_username
    return render(request, 'admin/franchise_admin_details.html', context)


@super_admin_required
def franchise_admin_players(request, admin_id):
    """List all players under this Admin tree (Admin + Agents' players)."""
    try:
        admin_user = visible_staff_qs(request.user).get(id=admin_id)
    except User.DoesNotExist:
        messages.error(request, 'Franchise admin not found.')
        return redirect('franchise_balance')
    try:
        page_number = int(request.GET.get('pg', 1))
    except (ValueError, TypeError):
        page_number = 1
    status_filter = request.GET.get('status', 'all')
    search_query = request.GET.get('search', '')
    owner_filter = request.GET.get('owner', 'all')
    agent_ids = list(
        User.objects.filter(is_staff=True, works_under=admin_user, is_superuser=False)
        .exclude(staff_role=User.ROLE_ADMIN)
        .values_list('id', flat=True)
    )
    owner_ids = [admin_user.id] + agent_ids
    players_query = User.objects.filter(worker_id__in=owner_ids, is_staff=False).select_related('worker')
    if owner_filter == 'direct':
        players_query = players_query.filter(worker=admin_user)
    elif owner_filter.startswith('agent:'):
        try:
            aid = int(owner_filter.split(':', 1)[1])
            if aid in agent_ids:
                players_query = players_query.filter(worker_id=aid)
        except (ValueError, TypeError):
            pass
    if status_filter == 'active':
        players_query = players_query.filter(is_active=True)
    elif status_filter == 'inactive':
        players_query = players_query.filter(is_active=False)
    if search_query:
        players_query = players_query.filter(
            Q(username__icontains=search_query) |
            Q(email__icontains=search_query) |
            Q(phone_number__icontains=search_query)
        )
    players_query = players_query.order_by('-date_joined')
    paginator = Paginator(players_query, 20)
    try:
        page_obj = paginator.get_page(page_number)
    except Exception:
        page_obj = paginator.get_page(1)
    agents_for_filter = [
        {'id': a.id, 'username': a.username, 'key': f'agent:{a.id}'}
        for a in User.objects.filter(id__in=agent_ids).order_by('username')
    ]
    context = get_admin_context(request, {
        'admin_user': admin_user,
        'page_obj': page_obj,
        'status_filter': status_filter,
        'search_query': search_query,
        'owner_filter': owner_filter,
        'agents_for_filter': agents_for_filter,
        'page': 'franchise-balance',
    })
    return render(request, 'admin/franchise_admin_players.html', context)


@admin_required
def agent_details(request, agent_id):
    """
    Agent profile: info + wallets-style list of all users under this Agent
    (same kind of wallet info as /game-admin/wallets/, scoped to this Agent).
    """
    try:
        agent = User.objects.select_related('works_under').get(pk=agent_id, is_staff=True)
    except User.DoesNotExist:
        messages.error(request, 'Agent not found.')
        return redirect('agent_management')

    if is_super_admin(agent) or is_franchise_admin(agent):
        # Admins use the franchise details page
        if is_franchise_admin(agent) or agent.is_franchise_only:
            return redirect('franchise_admin_details', admin_id=agent.id)
        messages.error(request, 'Not an Agent account.')
        return redirect('agent_management')

    if not is_agent(agent) and not agent.works_under_id:
        messages.error(request, 'Not an Agent account.')
        return redirect('agent_management')

    # Scope: Franchise Admin only their Agents; Super Admin all
    if is_franchise_admin(request.user) and agent.works_under_id != request.user.id:
        messages.error(request, 'You can only view Agents under you.')
        return redirect('agent_management')
    if is_agent(request.user) and request.user.id != agent.id:
        messages.error(request, 'You do not have permission to view this Agent.')
        return redirect('admin_dashboard')

    try:
        page_number = int(request.GET.get('pg', 1) or request.GET.get('page', 1))
    except (ValueError, TypeError):
        page_number = 1
    status_filter = request.GET.get('status', 'all')
    balance_filter = request.GET.get('balance', 'all')  # all, has_balance, zero
    sort_by = request.GET.get('sort', 'balance_desc')
    search_query = (request.GET.get('search') or '').strip()

    # Wallets for players under this Agent (same shape as Wallets page)
    base_wallets = Wallet.objects.filter(
        user__worker=agent,
        user__is_staff=False,
    ).select_related('user')

    wallets_query = base_wallets
    if status_filter == 'active':
        wallets_query = wallets_query.filter(user__is_active=True)
    elif status_filter == 'inactive':
        wallets_query = wallets_query.filter(user__is_active=False)

    if balance_filter == 'has_balance':
        wallets_query = wallets_query.filter(balance__gt=0)
    elif balance_filter == 'zero':
        wallets_query = wallets_query.filter(balance=0)

    if search_query:
        wallets_query = wallets_query.filter(
            Q(user__username__icontains=search_query) |
            Q(user__email__icontains=search_query) |
            Q(user__phone_number__icontains=search_query)
        )

    if sort_by == 'balance_asc':
        wallets_query = wallets_query.order_by('balance')
    elif sort_by == 'username_asc':
        wallets_query = wallets_query.order_by('user__username')
    elif sort_by == 'username_desc':
        wallets_query = wallets_query.order_by('-user__username')
    elif sort_by == 'joined_desc':
        wallets_query = wallets_query.order_by('-user__date_joined')
    else:
        wallets_query = wallets_query.order_by('-balance')

    total_players = User.objects.filter(worker=agent, is_staff=False).count()
    total_wallets = base_wallets.count()
    total_balance = base_wallets.aggregate(s=Sum('balance'))['s'] or 0
    active_wallets = base_wallets.filter(balance__gt=0).count()
    zero_balance_wallets = base_wallets.filter(balance=0).count()

    paginator = Paginator(wallets_query, 50)
    try:
        page_obj = paginator.get_page(page_number)
    except Exception:
        page_obj = paginator.get_page(1)

    parent = agent.works_under
    total_deposits = (
        DepositRequest.objects.filter(user__worker=agent, status='APPROVED')
        .aggregate(s=Coalesce(Sum('amount'), 0))['s'] or 0
    )
    total_withdrawals = (
        WithdrawRequest.objects.filter(
            user__worker=agent,
            status__in=['APPROVED', 'COMPLETED'],
        ).aggregate(s=Coalesce(Sum('amount'), 0))['s'] or 0
    )

    context = get_admin_context(request, {
        'agent_user': agent,
        'parent_admin': parent,
        'page_obj': page_obj,
        'wallets': page_obj,
        'total_players': total_players,
        'total_wallets': total_wallets,
        'total_balance': total_balance,
        'active_wallets': active_wallets,
        'zero_balance_wallets': zero_balance_wallets,
        'status_filter': status_filter,
        'balance_filter': balance_filter,
        'sort_by': sort_by,
        'search_query': search_query,
        'total_deposits': total_deposits,
        'total_withdrawals': total_withdrawals,
        'page': 'agent-management',
    })
    return render(request, 'admin/agent_details.html', context)


@super_admin_required
def edit_franchise_admin(request, admin_id):
    """Edit franchise owner menu permissions only (from Franchise Balance → Edit privileges)."""
    try:
        user = visible_staff_qs(request.user).get(id=admin_id)
    except User.DoesNotExist:
        messages.error(request, 'Franchise admin not found.')
        return redirect('franchise_balance')
    try:
        permissions = AdminPermissions.objects.get(user=user)
    except AdminPermissions.DoesNotExist:
        permissions = AdminPermissions.objects.create(user=user)
    if request.method == 'POST':
        requested = permissions_dict_from_post(request.POST)
        # game_history defaults on when missing from form
        if 'can_view_game_history' not in request.POST:
            requested['can_view_game_history'] = True
        capped = cap_permissions(requested, request.user, for_agent=False)
        apply_permissions_to_user(user, capped)
        if getattr(user, 'staff_role', None) != User.ROLE_ADMIN:
            sync_staff_flags(user, User.ROLE_ADMIN)
            user.save(update_fields=['staff_role', 'is_staff', 'is_superuser', 'is_franchise_only', 'works_under_id'])
        messages.success(request, f'Privileges for Admin "{user.username}" updated.')
        return redirect('franchise_balance')
    context = get_admin_context(request, {
        'admin_user': user,
        'permissions': permissions,
        'permission_items': build_permission_checklist_items(
            permissions, granter=request.user, for_agent=False, actor_is_super=True,
        ),
        'page': 'franchise-balance',
    })
    return render(request, 'admin/edit_franchise_admin.html', context)


@super_admin_required
def create_franchise_admin(request):
    """Create a franchise owner (admin) - appears only in Franchise Balance list, not in Worker Management."""
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')
        password2 = request.POST.get('password2') or request.POST.get('confirm_password') or ''
        permissions = permissions_dict_from_post(request.POST)
        def _cfa_ctx(perms):
            return get_admin_context(request, {
                'permissions': perms,
                'permission_items': build_permission_checklist_items(
                    perms, granter=request.user, for_agent=False, actor_is_super=True,
                ),
                'page': 'franchise-balance',
            })
        if not username or not password:
            messages.error(request, 'Username and password are required.')
            return render(request, 'admin/create_franchise_admin.html', _cfa_ctx(permissions))
        if password != password2:
            messages.error(request, 'Passwords do not match.')
            return render(request, 'admin/create_franchise_admin.html', _cfa_ctx(permissions))
        if len(password) < 4:
            messages.error(request, 'Password must be at least 4 characters long.')
            return render(request, 'admin/create_franchise_admin.html', _cfa_ctx(permissions))
        if User.objects.filter(username=username).exists():
            messages.error(request, 'Username already exists.')
            return render(request, 'admin/create_franchise_admin.html', _cfa_ctx(permissions))
        try:
            email = f"{username}@gundu.ata"
            capped = cap_permissions(permissions, request.user, for_agent=False)
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password,
                is_staff=True,
                is_superuser=False,
                is_active=True,
                is_franchise_only=True,
                staff_role=User.ROLE_ADMIN,
            )
            if not user.referral_code:
                user.referral_code = user.generate_unique_referral_code()
                user.save(update_fields=['referral_code'])
            apply_permissions_to_user(user, capped)
            FranchiseBalance.objects.get_or_create(user=user, defaults={'balance': 0})
            if request.POST.get('password_auto_generated', 'false') == 'true':
                messages.success(request, f'Admin "{username}" created. Referral code: {user.referral_code}. 🔐 Save the password securely.')
            else:
                messages.success(request, f'Admin "{username}" created. Referral code for Agents: {user.referral_code}.')
            return redirect('franchise_balance')
        except Exception as e:
            messages.error(request, f'Error creating franchise admin: {str(e)}')
            return render(request, 'admin/create_franchise_admin.html', _cfa_ctx(permissions))
    defaults = _admin_default_permissions()
    return render(request, 'admin/create_franchise_admin.html', get_admin_context(request, {
        'permissions': defaults,
        'permission_items': build_permission_checklist_items(
            defaults, granter=request.user, for_agent=False, actor_is_super=True,
        ),
        'page': 'franchise-balance',
    }))


@super_admin_required
def edit_admin(request, admin_id):
    """Edit admin user permissions"""
    try:
        user = visible_staff_qs(request.user).get(id=admin_id)
    except User.DoesNotExist:
        messages.error(request, 'Admin user not found.')
        return redirect('admin_management')
    
    # Super users cannot be edited through this interface
    if user.is_superuser:
        messages.error(request, 'Super Admin accounts cannot be edited through this interface.')
        return redirect('admin_management')
    
    # Get or create permissions
    try:
        permissions = AdminPermissions.objects.get(user=user)
    except AdminPermissions.DoesNotExist:
        permissions = AdminPermissions.objects.create(user=user)
    
    if request.method == 'POST':
        # Update permissions
        permissions.can_view_dashboard = request.POST.get('can_view_dashboard') == 'on'
        permissions.can_control_dice = request.POST.get('can_control_dice') == 'on'
        permissions.can_view_recent_rounds = request.POST.get('can_view_recent_rounds') == 'on'
        permissions.can_view_all_bets = request.POST.get('can_view_all_bets') == 'on'
        permissions.can_view_wallets = request.POST.get('can_view_wallets') == 'on'
        permissions.can_view_players = request.POST.get('can_view_players') == 'on'
        permissions.can_view_deposit_requests = request.POST.get('can_view_deposit_requests') == 'on'
        permissions.can_view_withdraw_requests = request.POST.get('can_view_withdraw_requests') == 'on'
        permissions.can_view_transactions = request.POST.get('can_view_transactions') == 'on'
        permissions.can_view_game_history = request.POST.get('can_view_game_history', 'on') == 'on'
        permissions.can_view_game_settings = request.POST.get('can_view_game_settings') == 'on'
        permissions.can_view_help_center = request.POST.get('can_view_help_center') == 'on'
        permissions.can_view_white_label = request.POST.get('can_view_white_label') == 'on'
        permissions.can_view_admin_management = request.POST.get('can_view_admin_management') == 'on'
        permissions.can_manage_payment_methods = request.POST.get('can_manage_payment_methods') == 'on'
        permissions.save()
        invalidate_admin_permissions_cache(user)
        works_under_id = request.POST.get('works_under_id', '').strip()
        if works_under_id:
            try:
                admin_user = visible_staff_qs(request.user).get(pk=int(works_under_id))
                user.works_under = admin_user if admin_user.id != user.id else None
                user.save(update_fields=['works_under_id'])
            except (ValueError, User.DoesNotExist):
                user.works_under = None
                user.save(update_fields=['works_under_id'])
        else:
            if user.works_under_id:
                user.works_under = None
                user.save(update_fields=['works_under_id'])
        # Update username if provided
        new_username = request.POST.get('username')
        username_updated = False
        if new_username and new_username != user.username:
            if User.objects.filter(username=new_username).exclude(id=user.id).exists():
                messages.error(request, 'Username already in use.')
            else:
                user.username = new_username
                user.save()
                username_updated = True

        # Update account status
        is_active = request.POST.get('is_active') == 'on'
        if is_active != user.is_active:
            user.is_active = is_active
            user.save()
            username_updated = True # Use this flag to trigger success message if nothing else changed

        # Update password if provided
        new_password = request.POST.get('new_password', '')
        if new_password:
            password2 = (request.POST.get('password2') or request.POST.get('confirm_password') or '')
            if new_password == password2:
                user.set_password(new_password)
                user.save()
                messages.success(request, f'Password updated for "{user.username}".')
            else:
                messages.error(request, 'Passwords do not match.')
                return redirect('admin_management')

        if username_updated or not new_password:
            messages.success(request, f'Admin "{user.username}" updated successfully!')

        return redirect('admin_management')
    
    context = get_admin_context(request, {
        'admin_user': user,
        'permissions': permissions,
        'queue_owners': _get_queue_owners(request.user),
    })
    return render(request, 'admin/edit_admin.html', context)

@super_admin_required
def delete_admin(request, admin_id):
    """Delete worker and redistribute their players"""
    try:
        user = visible_staff_qs(request.user).get(id=admin_id)
    except User.DoesNotExist:
        messages.error(request, 'Worker not found.')
        return redirect('admin_management')
    
    # Cannot delete superusers
    if user.is_superuser:
        messages.error(request, 'Cannot delete Super Admin accounts.')
        return redirect('admin_management')
    
    # Cannot delete yourself
    if user.id == request.user.id:
        messages.error(request, 'You cannot delete your own account.')
        return redirect('admin_management')
    
    # Count players that will be redistributed
    player_count = User.objects.filter(worker=user, is_staff=False).count()
    username = user.username
    
    # Delete admin (signal will handle redistribution)
    user.delete()  # This will also delete AdminPermissions due to CASCADE
    
    if player_count > 0:
        messages.success(request, f'Worker "{username}" deleted successfully! {player_count} players redistributed among remaining workers.')
    else:
        messages.success(request, f'Worker "{username}" deleted successfully!')
    return redirect('admin_management')

def _player_owner_choices(actor):
    """Owner options for creating a player under Super Admin / Admin / Agent."""
    owner_choices = []
    default_owner_id = None
    if is_super_admin(actor):
        in_scope = visible_staff_qs(actor).filter(is_active=True)
        for a in in_scope.filter(
            Q(staff_role=User.ROLE_ADMIN) | Q(is_franchise_only=True)
        ).exclude(is_superuser=True).exclude(staff_role=User.ROLE_AGENT).order_by('username'):
            owner_choices.append({'id': a.id, 'label': f'Admin: {a.username}'})
        for ag in in_scope.filter(
            Q(staff_role=User.ROLE_AGENT) | Q(works_under__isnull=False, is_franchise_only=False)
        ).exclude(staff_role=User.ROLE_ADMIN).exclude(is_superuser=True).order_by('username'):
            parent = ag.works_under.username if ag.works_under_id else '?'
            owner_choices.append({'id': ag.id, 'label': f'Agent: {ag.username} (under {parent})'})
        if is_god(actor):
            # Players may never sit under God — offer the Super Admins instead
            for sa in in_scope.filter(staff_role=User.ROLE_SUPER_ADMIN).order_by('username'):
                owner_choices.insert(0, {'id': sa.id, 'label': f'Super Admin: {sa.username}'})
            default_owner_id = owner_choices[0]['id'] if owner_choices else None
        else:
            owner_choices.insert(0, {'id': actor.id, 'label': f'Super Admin: {actor.username}'})
            default_owner_id = actor.id
    elif is_franchise_admin(actor):
        owner_choices.append({'id': actor.id, 'label': f'Me (Admin: {actor.username})'})
        for ag in User.objects.filter(
            is_staff=True, works_under=actor, is_active=True
        ).exclude(staff_role=User.ROLE_ADMIN).order_by('username'):
            owner_choices.append({'id': ag.id, 'label': f'Agent: {ag.username}'})
        default_owner_id = actor.id
    elif is_agent(actor):
        owner_choices.append({'id': actor.id, 'label': f'Me (Agent: {actor.username})'})
        default_owner_id = actor.id
    return owner_choices, default_owner_id


def _create_player_from_post(request, owner_choices, default_owner_id):
    """
    Process create-user POST. Returns (redirect_response_or_None, form_dict, keep_panel_open).
    On success returns a redirect; on failure returns None + form values + True.
    """
    actor = request.user
    username = (request.POST.get('username') or '').strip()
    password = request.POST.get('password') or ''
    password2 = request.POST.get('password2') or request.POST.get('confirm_password') or ''
    phone_number = (request.POST.get('phone_number') or '').strip()
    owner_id = (request.POST.get('owner_id') or '').strip()
    form = {
        'username': username,
        'phone_number': phone_number,
        'owner_id': owner_id or str(default_owner_id or ''),
    }

    allowed_owner_ids = {c['id'] for c in owner_choices}
    try:
        owner_pk = int(owner_id) if owner_id else default_owner_id
    except (TypeError, ValueError):
        owner_pk = default_owner_id

    if not username or not password:
        messages.error(request, 'Username and password are required.')
        return None, form, True
    if password != password2:
        messages.error(request, 'Passwords do not match.')
        return None, form, True
    if len(password) < 4:
        messages.error(request, 'Password must be at least 4 characters.')
        return None, form, True
    if User.objects.filter(username__iexact=username).exists():
        messages.error(request, 'Username already exists.')
        return None, form, True
    if owner_pk not in allowed_owner_ids:
        messages.error(request, 'Invalid ownership selection.')
        return None, form, True

    clean_phone = None
    if phone_number:
        try:
            from accounts.sms_service import sms_service
            clean_phone = sms_service._clean_phone_number(phone_number, for_sms=False)
        except Exception:
            clean_phone = phone_number
        if User.objects.filter(phone_number=clean_phone).exists():
            messages.error(request, 'Phone number already registered.')
            return None, form, True

    try:
        owner = visible_staff_qs(request.user).get(pk=owner_pk)
        with db_transaction.atomic():
            user = User.objects.create_user(
                username=username,
                password=password,
                email=f'{username}@gundu.ata',
                phone_number=clean_phone,
                is_staff=False,
                is_superuser=False,
                is_active=True,
                is_franchise_only=False,
                staff_role=User.ROLE_PLAYER,
                worker=owner,
                referred_by=actor if actor.id != owner.id else owner,
            )
            if not user.referral_code:
                user.referral_code = user.generate_unique_referral_code()
                user.save(update_fields=['referral_code'])
            Wallet.objects.get_or_create(user=user, defaults={'balance': 0})
        messages.success(
            request,
            f'User "{user.username}" created under {owner.username}.',
        )
        return redirect('user_details', user_id=user.id), form, False
    except Exception as e:
        logger.exception('create_player failed: %s', e)
        messages.error(request, f'Could not create user: {e}')
        return None, form, True


@login_required(login_url='/game-admin/login/')
@admin_required
def manage_players(request):
    """
    All Users list (players) + Create User panel, scoped by role:
      Super Admin → every player
      Admin → players under Admin + Agents in their tree
      Agent → players under that Agent
    """
    if not (
        has_menu_permission(request.user, 'players')
        or is_super_admin(request.user)
        or is_franchise_admin(request.user)
        or is_agent(request.user)
    ):
        messages.error(request, 'You do not have permission to view users.')
        return redirect('admin_dashboard')

    actor = request.user
    owner_choices, default_owner_id = _player_owner_choices(actor)
    can_create_user = bool(owner_choices)
    create_form = {
        'username': '',
        'phone_number': '',
        'owner_id': str(default_owner_id or ''),
    }
    show_create_panel = request.GET.get('create') == '1'

    if request.method == 'POST' and request.POST.get('action') == 'create_user':
        if not can_create_user:
            messages.error(request, 'You do not have permission to create users.')
            return redirect('manage_players')
        redirect_resp, create_form, show_create_panel = _create_player_from_post(
            request, owner_choices, default_owner_id
        )
        if redirect_resp:
            return redirect_resp

    # Get status filter from query params
    status_filter = request.GET.get('status', 'all')
    try:
        page_number = int(request.GET.get('pg', 1))
    except (ValueError, TypeError):
        page_number = 1
    search_query = request.GET.get('search', '')
    
    # Build query - only show actual players (not staff), prefetch worker for display
    users_query = User.objects.filter(is_staff=False).select_related('worker')
    users_query = _scope_by_owner(users_query, request.user, "worker")
    
    # Apply status filter
    if status_filter == 'active':
        users_query = users_query.filter(is_active=True)
    elif status_filter == 'inactive':
        users_query = users_query.filter(is_active=False)
    
    # Apply search filter
    if search_query:
        users_query = users_query.filter(
            Q(username__icontains=search_query) |
            Q(email__icontains=search_query) |
            Q(phone_number__icontains=search_query)
        )
    
    # Order by joined date
    users_query = users_query.order_by('-date_joined')
    
    # Pagination
    paginator = Paginator(users_query, 20)
    try:
        page_obj = paginator.get_page(page_number)
    except Exception:
        page_obj = None
    
    # Statistics (same scope as list)
    base_players = User.objects.filter(is_staff=False)
    base_players = _scope_by_owner(base_players, request.user, "worker")
    total_users = base_players.count()
    active_users = base_players.filter(is_active=True).count()
    inactive_users = base_players.filter(is_active=False).count()

    if is_super_admin(request.user):
        scope_label = 'All users'
        scope_blurb = 'Every player on the platform.'
    elif is_franchise_admin(request.user):
        scope_label = 'Your tree'
        scope_blurb = 'All users under you and your Agents.'
    elif is_agent(request.user):
        scope_label = 'Your users'
        scope_blurb = 'All users assigned to you.'
    else:
        scope_label = None
        scope_blurb = 'Users in your scope.'

    context = get_admin_context(request, {
        'page_obj': page_obj,
        'status_filter': status_filter,
        'search_query': search_query,
        'total_users': total_users,
        'active_users': active_users,
        'inactive_users': inactive_users,
        'page': 'manage-players',
        'is_franchise_scope': not is_super_admin(request.user),
        'scope_label': scope_label,
        'scope_blurb': scope_blurb,
        'can_create_user': can_create_user,
        'owner_choices': owner_choices,
        'create_form': create_form,
        'default_owner_id': default_owner_id,
        'show_create_panel': show_create_panel,
    })
    
    return render(request, 'admin/players_list.html', context)


@login_required(login_url='/game-admin/login/')
@admin_required
def create_player(request):
    """Legacy URL — Create User lives on All Users now."""
    if request.method == 'POST':
        owner_choices, default_owner_id = _player_owner_choices(request.user)
        if not owner_choices:
            messages.error(request, 'You do not have permission to create users.')
            return redirect('manage_players')
        redirect_resp, _, _ = _create_player_from_post(
            request, owner_choices, default_owner_id
        )
        if redirect_resp:
            return redirect_resp
        return redirect('/game-admin/players-list/?create=1')
    return redirect('/game-admin/players-list/?create=1')


@login_required(login_url='/game-admin/login/')
@admin_required
def players(request):
    """Admin management page - only shows admins and super admins"""
    # Only super admins can access this page
    if not is_super_admin(request.user):
        messages.error(request, 'Only Super Admins can access admin management.')
        return redirect('admin_dashboard')

    # Get status filter from query params, default to 'active'
    status_filter = request.GET.get('status', 'active')
    try:
        page_number = int(request.GET.get('pg', 1))
    except (ValueError, TypeError):
        page_number = 1
    search_query = request.GET.get('search', '')

    # Build query - staff in the viewer's own subtree only, never God
    users_query = visible_staff_qs(
        request.user, User.objects.filter(Q(is_staff=True) | Q(is_superuser=True))
    )

    # Apply status filter - default to active
    if status_filter == 'active':
        users_query = users_query.filter(is_active=True)
    elif status_filter == 'inactive':
        users_query = users_query.filter(is_active=False)

    # Apply search filter
    if search_query:
        users_query = users_query.filter(
            Q(username__icontains=search_query) |
            Q(email__icontains=search_query) |
            Q(phone_number__icontains=search_query)
        )

    # Order by superuser first, then staff
    users_query = users_query.order_by('-is_superuser', '-is_staff', 'username')

    # Annotate admins with client count
    for admin in users_query:
        admin.client_count = User.objects.filter(worker=admin, is_staff=False).count()

    # Pagination
    paginator = Paginator(users_query, 20)  # 20 users per page
    try:
        page_obj = paginator.get_page(page_number)
    except Exception as e:
        page_obj = None

    # Statistics - only count admins and super admins
    total_users = users_query.count()
    active_users = users_query.filter(is_active=True).count()
    inactive_users = users_query.filter(is_active=False).count()

    context = get_admin_context(request, {
        'page_obj': page_obj,
        'total_users': total_users,
        'active_users': active_users,
        'inactive_users': inactive_users,
        'status_filter': status_filter,
        'search_query': search_query,
        'page': 'players',
    })

    return render(request, 'admin/players.html', context)


@login_required(login_url='/game-admin/login/')
@admin_required
def assign_worker(request):
    """Manually assign a client to an admin (super admins only). No automatic reassignment."""
    if request.method == 'POST':
        client_id = request.POST.get('client_id')
        worker_id = request.POST.get('worker_id')
        
        if not is_super_admin(request.user):
            messages.error(request, 'Only Super Admins can assign players.')
            return redirect('manage_players')
            
        try:
            client = get_scoped_player_qs(request.user).get(id=client_id)
            if worker_id:
                # Only allow assignment to admins in the actor's own subtree
                admins = visible_staff_qs(request.user, get_admins_for_distribution())
                worker = admins.filter(id=worker_id).first()
                if not worker:
                    messages.error(request, 'Invalid admin. Players can only be assigned to admins.')
                    return redirect('manage_players')
                client.worker = worker
                messages.success(request, f'Player {client.username} assigned to {worker.username}.')
            else:
                client.worker = None
                messages.success(request, f'Player {client.username} unassigned.')
            client.save()
        except User.DoesNotExist:
            messages.error(request, 'User not found.')
            
    return redirect('manage_players')


def _gundu_ata_timing_defs():
    from django.conf import settings as django_settings
    default_settings = getattr(django_settings, 'GAME_SETTINGS', {})
    return [
        {
            'key': 'BETTING_CLOSE_TIME',
            'default': default_settings.get('BETTING_CLOSE_TIME', 30),
            'description': 'Time in seconds when betting closes (default: 30)',
            'label': 'Betting Close Time (When betting closes)',
        },
        {
            'key': 'DICE_ROLL_TIME',
            'default': default_settings.get('DICE_ROLL_TIME', 7),
            'description': 'Time in seconds before dice result when dice roll warning is sent (default: 7)',
            'label': 'Dice Rolling Time (Seconds before dice result when warning is sent)',
        },
        {
            'key': 'DICE_RESULT_TIME',
            'default': default_settings.get('DICE_RESULT_TIME', 51),
            'description': 'Time in seconds when dice result is announced (default: 51)',
            'label': 'Dice Result Time (When dice result is announced)',
        },
        {
            'key': 'ROUND_END_TIME',
            'default': default_settings.get('ROUND_END_TIME', 80),
            'description': 'Total round duration in seconds (default: 80)',
            'label': 'Round End Time (Total round duration)',
        },
        {
            'key': 'MAX_BET',
            'default': default_settings.get('MAX_BET', 50000),
            'description': 'Maximum bet amount per number (default: 50000)',
            'label': 'Maximum Bet Amount (Per number)',
        },
    ]


def _load_gundu_ata_timing_settings():
    settings_list = []
    for setting_info in _gundu_ata_timing_defs():
        key = setting_info['key']
        try:
            setting = GameSettings.objects.get(key=key)
            value = int(setting.value)
            description = setting.description or setting_info['description']
        except (GameSettings.DoesNotExist, ValueError, TypeError):
            value = setting_info['default']
            description = setting_info['description']
        settings_list.append({
            'key': key,
            'value': value,
            'description': description,
            'default': setting_info['default'],
            'label': setting_info['label'],
        })
    return settings_list


def _save_gundu_ata_timing_settings(post_data):
    """Validate + save Gundu Ata timing/max-bet. Returns (ok, errors)."""
    settings_to_manage = _gundu_ata_timing_defs()
    errors = []
    new_values = {}

    for setting_info in settings_to_manage:
        key = setting_info['key']
        new_value = post_data.get(key)
        if new_value in (None, ''):
            continue
        try:
            int_value = int(new_value)
            if int_value < 1:
                errors.append(f"{setting_info['label']} must be at least 1")
                continue
            new_values[key] = int_value
        except ValueError:
            errors.append(f"{setting_info['label']} must be a valid number")

    if not errors and len(new_values) >= 3:
        betting_close = new_values.get('BETTING_CLOSE_TIME')
        dice_roll = new_values.get('DICE_ROLL_TIME')
        dice_result = new_values.get('DICE_RESULT_TIME')
        round_end = new_values.get('ROUND_END_TIME')

        if betting_close and dice_result and round_end:
            if betting_close >= dice_result:
                errors.append(
                    f"Betting close time ({betting_close}s) must be less than dice result time ({dice_result}s)"
                )
            if dice_result >= round_end:
                errors.append(
                    f"Dice result time ({dice_result}s) must be less than round end time ({round_end}s)"
                )
        if dice_roll and dice_result and dice_roll >= dice_result:
            errors.append(
                f"Dice roll time ({dice_roll}s) must be less than dice result time ({dice_result}s)"
            )

    if errors or not new_values:
        return False, errors or ['No settings to save.']

    for key, int_value in new_values.items():
        setting_info = next(s for s in settings_to_manage if s['key'] == key)
        GameSettings.objects.update_or_create(
            key=key,
            defaults={
                'value': str(int_value),
                'description': setting_info['description'],
            },
        )
    clear_game_setting_cache([s['key'] for s in settings_to_manage])
    return True, []


@login_required(login_url='/game-admin/login/')
@admin_required
def game_settings(request):
    """App / system settings (APK update, maintenance). Gundu Ata timing lives under Games → Gundu Ata."""
    if not has_menu_permission(request.user, 'game_settings'):
        messages.error(request, 'You do not have permission to access Game Settings.')
        return redirect('admin_dashboard')
    
    # App version settings (for APK update prompts)
    app_version_settings = [
        {
            'key': 'APP_VERSION_CODE',
            'default': 1,
            'input_type': 'number',
            'description': 'Version code of latest APK. Bump this when you release a new APK. Users with lower versionCode will see update prompt.'
        },
        {
            'key': 'APP_VERSION_NAME',
            'default': '1.0',
            'input_type': 'text',
            'description': 'Display version name (e.g. 1.0, 1.1). Shown to users in update dialog.'
        },
        {
            'key': 'APP_DOWNLOAD_URL',
            'default': 'https://gunduata.club/gundu-ata.apk',
            'input_type': 'url',
            'description': 'Direct URL to download the latest APK. Users tap "Update" to open this link.'
        },
        {
            'key': 'APP_FORCE_UPDATE',
            'default': False,
            'input_type': 'checkbox',
            'description': 'When ticked: users cannot use the APK until they update. The update screen cannot be dismissed.'
        },
    ]
    
    # Get current app version settings
    app_version_current = {}
    for setting_info in app_version_settings:
        try:
            setting = GameSettings.objects.get(key=setting_info['key'])
            if setting_info['input_type'] == 'number':
                val = int(setting.value)
            elif setting_info['input_type'] == 'checkbox':
                val = setting.value.lower() in ('true', '1', 'yes')
            else:
                val = setting.value
            app_version_current[setting_info['key']] = {
                'value': val,
                'description': setting.description or setting_info['description'],
                'exists': True
            }
        except (GameSettings.DoesNotExist, ValueError):
            app_version_current[setting_info['key']] = {
                'value': setting_info['default'],
                'description': setting_info['description'],
                'exists': False
            }
    
    if request.method == 'POST' and request.POST.get('form_type') == 'telegram_bot':
        from . import telegram_utils as tg
        # Blank means "leave the saved token alone" so editing the other fields
        # can never silently wipe the secret; clearing is explicit.
        token_input = (request.POST.get('TELEGRAM_BOT_TOKEN') or '').strip()
        if request.POST.get('clear_token') == 'on':
            token = ''
        else:
            token = token_input or tg.get_bot_token()
        bot_username = (request.POST.get('TELEGRAM_BOT_USERNAME') or '').strip().lstrip('@')
        enabled = 'on' if request.POST.get('TELEGRAM_LOGIN_ALERTS') == 'on' else 'off'
        GameSettings.objects.update_or_create(
            key=tg.SETTING_BOT_TOKEN,
            defaults={'value': token, 'description': 'Telegram bot token from @BotFather (admin login alerts)'},
        )
        GameSettings.objects.update_or_create(
            key=tg.SETTING_BOT_USERNAME,
            defaults={'value': bot_username, 'description': 'Telegram bot username without @ (used to build connect links)'},
        )
        GameSettings.objects.update_or_create(
            key=tg.SETTING_ALERTS_ENABLED,
            defaults={'value': enabled, 'description': 'Master switch for admin login alerts on Telegram'},
        )
        clear_game_setting_cache([
            tg.SETTING_BOT_TOKEN, tg.SETTING_BOT_USERNAME, tg.SETTING_ALERTS_ENABLED,
        ])

        if token and request.POST.get('register_webhook') == 'on':
            base = (request.POST.get('webhook_base_url') or '').strip()
            if not base:
                base = f"{'https' if request.is_secure() else 'http'}://{request.get_host()}"
            ok, detail = tg.set_webhook(base)
            if ok:
                messages.success(request, f'Telegram webhook registered at {detail}')
            else:
                messages.error(request, f'Webhook registration failed: {detail}')

        if token:
            ok, info = tg.get_bot_info()
            if ok:
                name = info.get('username') or ''
                if name and name != bot_username:
                    GameSettings.objects.update_or_create(
                        key=tg.SETTING_BOT_USERNAME,
                        defaults={'value': name, 'description': 'Telegram bot username without @ (used to build connect links)'},
                    )
                    clear_game_setting_cache([tg.SETTING_BOT_USERNAME])
                messages.success(request, f'Telegram bot verified: @{name or "unknown"}')
            else:
                messages.error(request, f'Telegram bot token rejected: {info}')
        else:
            messages.success(request, 'Telegram bot settings saved.')
        return redirect('game_settings')

    # Handle form submission (app version only — Gundu Ata timing is under Games → Gundu Ata)
    if request.method == 'POST':
        for setting_info in app_version_settings:
            key = setting_info['key']
            if setting_info['input_type'] == 'number':
                val = request.POST.get(key)
                if val is not None:
                    try:
                        GameSettings.objects.update_or_create(
                            key=key,
                            defaults={
                                'value': str(int(val)),
                                'description': setting_info['description']
                            }
                        )
                    except ValueError:
                        pass
            elif setting_info['input_type'] == 'checkbox':
                GameSettings.objects.update_or_create(
                    key=key,
                    defaults={
                        'value': 'true' if request.POST.get(key) == 'on' else 'false',
                        'description': setting_info['description']
                    }
                )
            else:
                val = request.POST.get(key)
                if val is not None:
                    GameSettings.objects.update_or_create(
                        key=key,
                        defaults={
                            'value': val.strip(),
                            'description': setting_info['description']
                        }
                    )

        clear_game_setting_cache([s['key'] for s in app_version_settings])
        messages.success(request, 'App settings updated successfully.')
        return redirect('game_settings')

    # Prepare app version settings list for template
    app_version_list = []
    for setting_info in app_version_settings:
        key = setting_info['key']
        setting_data = app_version_current[key]
        app_version_list.append({
            'key': key,
            'value': setting_data['value'],
            'description': setting_data['description'],
            'input_type': setting_info['input_type'],
        })
    
    # Maintenance mode status (for display in template)
    maintenance_enabled = False
    maintenance_until = None
    if getattr(settings, 'REDIS_POOL', None):
        try:
            r = redis.Redis(connection_pool=settings.REDIS_POOL)
            if r.get('maintenance_mode'):
                maintenance_enabled = True
                until_raw = r.get('maintenance_until')
                if until_raw:
                    maintenance_until = int(until_raw)
        except Exception:
            pass

    from . import telegram_utils as tg
    from .models import AdminTelegramLink
    tg_token = tg.get_bot_token()

    context = get_admin_context(request, {
        'app_version_list': app_version_list,
        'maintenance_enabled': maintenance_enabled,
        'maintenance_until': maintenance_until,
        'tg_token_set': bool(tg_token),
        'tg_token_masked': (tg_token[:8] + '…' + tg_token[-4:]) if len(tg_token) > 14 else '',
        'tg_bot_username': tg.get_bot_username(),
        'tg_alerts_enabled': tg.alerts_enabled(),
        'tg_linked_count': AdminTelegramLink.objects.exclude(chat_id='').count(),
        'tg_default_webhook_base': f"{'https' if request.is_secure() else 'http'}://{request.get_host()}",
        'page': 'game_settings',
        'admin_profile': get_admin_profile(request.user),
        'gundu_ata_settings_url': '/game-admin/games/dice/',
    })

    return render(request, 'admin/game_settings.html', context)


def _normalize_help_phone(raw: str) -> str:
    """Keep leading '+' and digits only; accept any country code."""
    if raw is None:
        return ''
    s = str(raw).strip()
    if not s:
        return ''
    keep_plus = s.startswith('+')
    digits = ''.join(ch for ch in s if ch.isdigit())
    if not digits:
        return ''
    return f"+{digits}" if keep_plus else digits


@login_required(login_url='/game-admin/login/')
@admin_required
def help_center(request):
    """Help Center: Super Admin sets global defaults; franchise owners set their own (per-franchise) numbers."""
    if not has_menu_permission(request.user, 'help_center'):
        messages.error(request, 'You do not have permission to access Help Center settings.')
        return redirect('admin_dashboard')

    effective_admin = get_effective_admin(request.user)
    global_whatsapp = get_game_setting('SUPPORT_WHATSAPP_NUMBER', '')
    global_telegram = get_game_setting('SUPPORT_TELEGRAM', '')

    if is_super_admin(effective_admin):
        whatsapp_number = global_whatsapp
        telegram_number = global_telegram
        is_franchise_scope = False
    else:
        try:
            fb = FranchiseBalance.objects.get(user=effective_admin)
            whatsapp_number = (fb.help_whatsapp_number or '').strip() or global_whatsapp
            telegram_number = (fb.help_telegram or '').strip() or global_telegram
        except FranchiseBalance.DoesNotExist:
            fb = None
            whatsapp_number = global_whatsapp
            telegram_number = global_telegram
        is_franchise_scope = True

    if request.method == 'POST':
        whatsapp_number = _normalize_help_phone(request.POST.get('SUPPORT_WHATSAPP_NUMBER'))
        telegram_number = _normalize_help_phone(request.POST.get('SUPPORT_TELEGRAM'))

        if is_super_admin(effective_admin):
            GameSettings.objects.update_or_create(
                key='SUPPORT_WHATSAPP_NUMBER',
                defaults={
                    'value': whatsapp_number,
                    'description': 'Help Center WhatsApp number (example: +919876543210)'
                }
            )
            GameSettings.objects.update_or_create(
                key='SUPPORT_TELEGRAM',
                defaults={
                    'value': telegram_number,
                    'description': 'Help Center Telegram phone number (example: +919876543210)'
                }
            )
            clear_game_setting_cache(['SUPPORT_WHATSAPP_NUMBER', 'SUPPORT_TELEGRAM'])
            messages.success(request, 'Global Help Center contacts updated successfully.')
        else:
            fb, _ = FranchiseBalance.objects.get_or_create(
                user=effective_admin,
                defaults={'balance': 0}
            )
            fb.help_whatsapp_number = whatsapp_number
            fb.help_telegram = telegram_number
            fb.save()
            messages.success(request, 'Your franchise Help Center contacts updated. Players under your franchise will see these numbers when they use the app with your package.')

        return redirect('help_center')

    context = get_admin_context(request, {
        'page': 'help_center',
        'whatsapp_number': whatsapp_number,
        'telegram_number': telegram_number,
        'admin_profile': get_admin_profile(request.user),
        'is_franchise_scope': is_franchise_scope,
        'scope_label': 'Your franchise' if is_franchise_scope else None,
    })
    return render(request, 'admin/help_center.html', context)


@login_required(login_url='/game-admin/login/')
@admin_required
def white_label_leads(request):
    """List White Label lead submissions"""
    if not has_menu_permission(request.user, 'white_label'):
        messages.error(request, 'You do not have permission to access White Label leads.')
        return redirect('admin_dashboard')

    q = (request.GET.get('q') or '').strip()
    leads_qs = WhiteLabelLead.objects.all()
    if q:
        leads_qs = leads_qs.filter(
            Q(name__icontains=q) |
            Q(phone_number__icontains=q) |
            Q(message__icontains=q)
        )

    paginator = Paginator(leads_qs, 50)
    leads_page = paginator.get_page(request.GET.get('p') or 1)

    context = get_admin_context(request, {
        'page': 'white_label',
        'admin_profile': get_admin_profile(request.user),
        'q': q,
        'leads_page': leads_page,
        'total_count': leads_qs.count(),
    })
    return render(request, 'admin/white_label_leads.html', context)


@login_required(login_url='/game-admin/login/')
@admin_required
def maintenance_toggle(request):
    """Enable or disable maintenance mode from admin panel. Requires game_settings permission."""
    if not has_menu_permission(request.user, 'game_settings'):
        messages.error(request, 'You do not have permission to manage maintenance.')
        return redirect('admin_dashboard')

    import time
    r = None
    if getattr(settings, 'REDIS_POOL', None):
        r = redis.Redis(connection_pool=settings.REDIS_POOL)

    if request.method == 'POST':
        action = request.POST.get('maintenance_action')
        if action == 'enable':
            duration_minutes = request.POST.get('maintenance_duration', '30')
            try:
                mins = int(duration_minutes)
                if mins < 1:
                    mins = 30
                elif mins > 480:  # max 8 hours
                    mins = 480
            except (ValueError, TypeError):
                mins = 30
            if r:
                now = int(time.time())
                until = now + (mins * 60)
                r.set('maintenance_mode', '1')
                r.set('maintenance_until', str(until))
                # Auto-disable after that time: Redis expires the key so maintenance ends even with no traffic
                r.expireat('maintenance_mode', until)
                r.expireat('maintenance_until', until)
                messages.success(request, f'Maintenance enabled for {mins} minutes. It will automatically turn off after that time.')
            else:
                messages.error(request, 'Redis not configured. Set MAINTENANCE_MODE=1 in environment instead.')
        elif action == 'disable':
            if r:
                r.delete('maintenance_mode')
                r.delete('maintenance_until')
                messages.success(request, 'Maintenance mode disabled. App is live again.')
            else:
                messages.error(request, 'Redis not configured. Unset MAINTENANCE_MODE in environment.')

    return redirect('game_settings')


@login_required(login_url='/game-admin/login/')
@require_POST
def logout_all_sessions(request):
    """Log out all users: invalidate all JWT (app) and clear all Django sessions (game-admin). Superuser only."""
    if not request.user.is_superuser:
        messages.error(request, 'Only superusers can log out all users.')
        return redirect('admin_dashboard')
    if not has_menu_permission(request.user, 'game_settings'):
        messages.error(request, 'You do not have permission to manage this.')
        return redirect('admin_dashboard')

    import time
    now = int(time.time())
    r = None
    if getattr(settings, 'REDIS_POOL', None):
        r = redis.Redis(connection_pool=settings.REDIS_POOL)

    # Invalidate all JWT (app users)
    if r:
        r.set('logout_all_issued_before', str(now))
        try:
            keys = list(r.scan_iter('user_session:*', count=1000))
            if keys:
                r.delete(*keys)
        except Exception:
            pass

    # Clear all Django sessions (game-admin users; you will be logged out too)
    count, _ = Session.objects.all().delete()

    messages.success(request, f'All users have been logged out. ({count} game-admin session(s) cleared; app users must log in again.)')
    return redirect('admin_login')


@admin_required
def payment_methods(request):
    """List payment methods. Super admin sees global (owner=null); franchise owners see only their own."""
    if not has_menu_permission(request.user, 'payment_methods'):
        messages.error(request, 'You do not have permission to manage payment methods.')
        return redirect('admin_dashboard')

    effective_admin = get_effective_admin(request.user)
    if is_super_admin(effective_admin):
        methods_qs = PaymentMethod.objects.filter(owner__isnull=True)
    else:
        methods_qs = PaymentMethod.objects.filter(owner=effective_admin)

    # Create default payment methods only for super admin when no global methods exist
    if is_super_admin(effective_admin) and not PaymentMethod.objects.filter(owner__isnull=True).exists():
        default_methods = [
            {
                'name': 'Bank Account',
                'method_type': 'BANK',
                'is_active': True,
                'usdt_network': '',
                'usdt_wallet_address': '',
            },
            {
                'name': 'Google Pay',
                'method_type': 'GPAY',
                'is_active': True,
                'usdt_network': '',
                'usdt_wallet_address': '',
            },
            {
                'name': 'Phone Pe',
                'method_type': 'PHONEPE',
                'is_active': True,
                'usdt_network': '',
                'usdt_wallet_address': '',
            },
            {
                'name': 'Paytm',
                'method_type': 'PAYTM',
                'is_active': True,
                'usdt_network': '',
                'usdt_wallet_address': '',
            },
            {
                'name': 'UPI',
                'method_type': 'UPI',
                'is_active': True,
                'usdt_network': '',
                'usdt_wallet_address': '',
            },
            {
                'name': 'QR',
                'method_type': 'QR',
                'is_active': True,
                'usdt_network': '',
                'usdt_wallet_address': '',
            },
        ]

        for method_data in default_methods:
            PaymentMethod.objects.create(owner=None, **method_data)

        messages.info(request, 'Created default payment methods. Please edit them with your actual payment details.')
        return redirect('payment_methods')

    methods = methods_qs.order_by('-is_active', 'method_type')

    # Get available method types (exclude already used ones within this scope)
    used_method_types = set(methods.values_list('method_type', flat=True))
    all_method_choices = PaymentMethod.METHOD_TYPES

    # Filter out already used method types
    available_method_types = [mt for mt in all_method_choices if mt[0] not in used_method_types]

    is_franchise_scope = not is_super_admin(effective_admin)
    context = get_admin_context(request, {
        'payment_methods': methods,
        'available_method_types': available_method_types,
        'page': 'payment-methods',
        'is_franchise_scope': is_franchise_scope,
        'scope_label': 'Your franchise' if is_franchise_scope else None,
    })
    return render(request, 'admin/payment_methods.html', context)

@admin_required
def create_payment_method(request):
    """Create a new payment method"""
    if not has_menu_permission(request.user, 'payment_methods'):
        messages.error(request, 'You do not have permission to manage payment methods.')
        return redirect('admin_dashboard')

    if request.method == 'POST':
        method_type = request.POST.get('method_type')
        upi_id = request.POST.get('upi_id', '')
        link = request.POST.get('link', '')
        account_name = request.POST.get('account_name', '')
        bank_name = request.POST.get('bank_name', '')
        account_number = request.POST.get('account_number', '')
        ifsc_code = request.POST.get('ifsc_code', '')
        qr_image = request.FILES.get('qr_image')
        is_active = request.POST.get('is_active') == 'on'
        usdt_network = request.POST.get('usdt_network', '') or ''
        usdt_wallet_address = request.POST.get('usdt_wallet_address', '') or ''
        usdt_exchange_rate = request.POST.get('usdt_exchange_rate', '90.00')
        if not usdt_exchange_rate or usdt_exchange_rate.strip() == '':
            usdt_exchange_rate = '90.00'

        if not method_type:
            messages.error(request, 'Method Type is required.')
            return redirect('payment_methods')

        effective_admin = get_effective_admin(request.user)
        owner_for_create = None if is_super_admin(effective_admin) else effective_admin
        scope_qs = PaymentMethod.objects.filter(owner=owner_for_create) if owner_for_create is not None else PaymentMethod.objects.filter(owner__isnull=True)
        if scope_qs.filter(method_type=method_type).exists():
            messages.error(request, 'This payment method type is already in use in your list.')
            return redirect('payment_methods')

        method_type_display = dict(PaymentMethod.METHOD_TYPES).get(method_type, method_type)

        try:
            import re
            clean_rate = re.sub(r'[^\d.]', '', str(usdt_exchange_rate))
            if not clean_rate or clean_rate == '.':
                clean_rate = '90.00'
            
            PaymentMethod.objects.create(
                owner=owner_for_create,
                name=method_type_display,
                method_type=method_type,
                upi_id=upi_id,
                link=link,
                account_name=account_name,
                bank_name=bank_name,
                account_number=account_number,
                ifsc_code=ifsc_code,
                qr_image=qr_image,
                is_active=is_active,
                usdt_network=usdt_network,
                usdt_wallet_address=usdt_wallet_address,
                usdt_exchange_rate=Decimal(clean_rate)
            )
            messages.success(request, f'Payment method "{method_type_display}" created successfully!')
        except Exception as e:
            import traceback
            traceback.print_exc()
            messages.error(request, f'Error creating payment method: {str(e)}')

    return redirect('payment_methods')

@admin_required
def edit_payment_method(request, pk):
    """Edit a payment method. Franchise can only edit their own."""
    if not has_menu_permission(request.user, 'payment_methods'):
        messages.error(request, 'You do not have permission to manage payment methods.')
        return redirect('admin_dashboard')

    effective_admin = get_effective_admin(request.user)
    if is_super_admin(effective_admin):
        method = get_object_or_404(PaymentMethod, pk=pk, owner__isnull=True)
    else:
        method = get_object_or_404(PaymentMethod, pk=pk, owner=effective_admin)

    if request.method == 'POST':
        method.method_type = request.POST.get('method_type')
        method.upi_id = request.POST.get('upi_id', '')
        method.link = request.POST.get('link', '')
        method.account_name = request.POST.get('account_name', '')
        method.bank_name = request.POST.get('bank_name', '')
        method.account_number = request.POST.get('account_number', '')
        method.ifsc_code = request.POST.get('ifsc_code', '')

        # Handle QR image upload
        if 'qr_image' in request.FILES:
            method.qr_image = request.FILES['qr_image']

        method.is_active = request.POST.get('is_active') == 'on'
        method.usdt_network = request.POST.get('usdt_network', '')
        method.usdt_wallet_address = request.POST.get('usdt_wallet_address', '')
        
        exchange_rate = request.POST.get('usdt_exchange_rate')
        if exchange_rate:
            try:
                method.usdt_exchange_rate = Decimal(exchange_rate)
            except (InvalidOperation, ValueError):
                pass

        if not method.method_type:
            messages.error(request, 'Method Type is required.')
        else:
            # Update the name based on method type
            method.name = dict(PaymentMethod.METHOD_TYPES).get(method.method_type, method.method_type)

            try:
                method.save()
                messages.success(request, f'Payment method "{method.name}" updated successfully!')
            except Exception as e:
                messages.error(request, f'Error updating payment method: {str(e)}')

    return redirect('payment_methods')

@admin_required
def delete_payment_method(request, pk):
    """Delete a payment method. Franchise can only delete their own."""
    if not has_menu_permission(request.user, 'payment_methods'):
        messages.error(request, 'You do not have permission to manage payment methods.')
        return redirect('admin_dashboard')

    if request.method == 'POST':
        effective_admin = get_effective_admin(request.user)
        if is_super_admin(effective_admin):
            method = get_object_or_404(PaymentMethod, pk=pk, owner__isnull=True)
        else:
            method = get_object_or_404(PaymentMethod, pk=pk, owner=effective_admin)
        name = method.name

        try:
            method.delete()
            messages.success(request, f'Payment method "{name}" deleted successfully!')
        except Exception as e:
            messages.error(request, f'Error deleting payment method: {str(e)}')

    return redirect('payment_methods')


@admin_required
def toggle_payment_method(request, pk):
    """Toggle active status of a payment method. Franchise can only toggle their own."""
    if not has_menu_permission(request.user, 'payment_methods'):
        messages.error(request, 'You do not have permission to manage payment methods.')
        return redirect('admin_dashboard')

    effective_admin = get_effective_admin(request.user)
    if is_super_admin(effective_admin):
        method = get_object_or_404(PaymentMethod, pk=pk, owner__isnull=True)
    else:
        method = get_object_or_404(PaymentMethod, pk=pk, owner=effective_admin)
    method.is_active = not method.is_active
    method.save()
    
    status = "activated" if method.is_active else "deactivated"
    messages.success(request, f'Payment method "{method.name}" {status} successfully!')
    return redirect('payment_methods')


@admin_required
def admin_games(request):
    """Games hub — card overview with today stats for every game."""
    if not has_menu_permission(request.user, 'games'):
        messages.error(request, 'You do not have permission to view games.')
        return redirect('admin_dashboard')

    from .admin_game_stats import build_games_overview

    effective_admin = get_effective_admin(request.user)
    is_super = sees_all_data(effective_admin)
    today_start, today_end, ist_date = _ist_day_bounds_utc(0)
    games = build_games_overview(effective_admin, is_super, today_start, today_end)

    totals = {
        'bets': sum(g['today']['bets'] for g in games),
        'wagered': sum((g['today']['wagered'] for g in games), Decimal('0')),
        'payout': sum((g['today']['payout'] for g in games), Decimal('0')),
        'active': sum(g['active'] for g in games),
    }
    totals['profit'] = totals['wagered'] - totals['payout']

    context = get_admin_context(request, {
        'page': 'games',
        'games': games,
        'totals': totals,
        'ist_date': ist_date,
        'is_franchise_scope': not is_super,
        'scope_label': 'Your franchise' if not is_super else None,
    })
    return render(request, 'admin/games.html', context)


@admin_required
def admin_game_detail(request, game_slug):
    """Detailed stats + searchable activity for a single game."""
    if not has_menu_permission(request.user, 'games'):
        messages.error(request, 'You do not have permission to view games.')
        return redirect('admin_dashboard')

    from .admin_game_stats import (
        build_game_detail,
        get_game_meta,
        activity_queryset,
        map_activity_rows,
        filtered_activity_stats,
        lookup_round_detail,
        parse_ist_date,
        list_recent_games,
    )

    if not get_game_meta(game_slug):
        messages.error(request, 'Unknown game.')
        return redirect('admin_games')

    # Gundu Ata (dice) timing / max-bet config lives on this page
    if game_slug == 'dice' and request.method == 'POST' and request.POST.get('form_type') == 'gundu_timing':
        if not has_menu_permission(request.user, 'game_settings'):
            messages.error(request, 'You do not have permission to change Gundu Ata settings.')
            return redirect('admin_game_detail', game_slug='dice')
        ok, errors = _save_gundu_ata_timing_settings(request.POST)
        if ok:
            messages.success(
                request,
                'Gundu Ata settings updated. Changes apply from the next round.',
            )
        else:
            for error in errors:
                messages.error(request, error)
        return redirect('admin_game_detail', game_slug='dice')

    effective_admin = get_effective_admin(request.user)
    is_super = sees_all_data(effective_admin)
    today_start, today_end, ist_date = _ist_day_bounds_utc(0)
    yday_start, yday_end, yday_date = _ist_day_bounds_utc(-1)
    game = build_game_detail(
        game_slug, effective_admin, is_super,
        today_start, today_end, yday_start, yday_end,
    )

    search = request.GET.get('q', '').strip()
    round_q = request.GET.get('round', '').strip()
    result = request.GET.get('result', 'all').strip().lower() or 'all'
    date_from_s = request.GET.get('from', '').strip()
    date_to_s = request.GET.get('to', '').strip()
    date_from = parse_ist_date(date_from_s, end_of_day=False)
    date_to = parse_ist_date(date_to_s, end_of_day=True)
    try:
        page_number = max(1, int(request.GET.get('page', 1)))
    except (TypeError, ValueError):
        page_number = 1

    qs = activity_queryset(
        game_slug, effective_admin, is_super,
        search=search, date_from=date_from, date_to=date_to,
        result=result, round_q=round_q,
    )
    filter_stats = filtered_activity_stats(game_slug, qs)
    paginator = Paginator(qs, 50)
    page_obj = paginator.get_page(page_number)
    rows = map_activity_rows(game_slug, page_obj.object_list)

    round_detail = None
    if round_q:
        round_detail = lookup_round_detail(game_slug, round_q, effective_admin, is_super)

    gundu_settings_list = None
    can_edit_gundu_settings = False
    if game_slug == 'dice':
        can_edit_gundu_settings = has_menu_permission(request.user, 'game_settings')
        if can_edit_gundu_settings or is_super:
            gundu_settings_list = _load_gundu_ata_timing_settings()
            can_edit_gundu_settings = True

    recent_games = list_recent_games(game_slug, effective_admin, is_super, limit=30)

    context = get_admin_context(request, {
        'page': 'game-detail',
        'game': game,
        'ist_date': ist_date,
        'yday_date': yday_date,
        'is_franchise_scope': not is_super,
        'scope_label': 'Your franchise' if not is_super else None,
        'rows': rows,
        'page_obj': page_obj,
        'filter_stats': filter_stats,
        'round_detail': round_detail,
        'recent_games': recent_games,
        'gundu_settings_list': gundu_settings_list,
        'can_edit_gundu_settings': can_edit_gundu_settings,
        'filters': {
            'q': search,
            'round': round_q,
            'result': result,
            'from': date_from_s,
            'to': date_to_s,
        },
    })
    return render(request, 'admin/game_detail.html', context)


@admin_required
def admin_game_round(request, game_slug, round_id):
    """Open a specific round/session for a game (non-dice) with clear bet list."""
    if not has_menu_permission(request.user, 'games'):
        messages.error(request, 'You do not have permission to view games.')
        return redirect('admin_dashboard')

    from .admin_game_stats import get_game_meta, lookup_round_detail, build_game_detail

    meta = get_game_meta(game_slug)
    if not meta:
        messages.error(request, 'Unknown game.')
        return redirect('admin_games')

    # Dice uses the existing full round page
    if game_slug == 'dice':
        return redirect('round_details', round_id=round_id)

    effective_admin = get_effective_admin(request.user)
    is_super = sees_all_data(effective_admin)
    today_start, today_end, ist_date = _ist_day_bounds_utc(0)
    yday_start, yday_end, yday_date = _ist_day_bounds_utc(-1)
    game = build_game_detail(
        game_slug, effective_admin, is_super,
        today_start, today_end, yday_start, yday_end,
    )
    round_detail = lookup_round_detail(game_slug, round_id, effective_admin, is_super)

    context = get_admin_context(request, {
        'page': 'game-detail',
        'game': game,
        'ist_date': ist_date,
        'yday_date': yday_date,
        'round_detail': round_detail,
        'round_id': round_id,
        'is_franchise_scope': not is_super,
        'scope_label': 'Your franchise' if not is_super else None,
        'rows': [],
        'page_obj': None,
        'filter_stats': None,
        'filters': {'q': '', 'round': round_id, 'result': 'all', 'from': '', 'to': ''},
        'round_only': True,
    })
    return render(request, 'admin/game_detail.html', context)


# ---------------------------------------------------------------------------
# Agent Management (Admin creates/refers Agents; Super Admin can view all)
# ---------------------------------------------------------------------------

def _agent_default_permissions():
    """Safe default checklist for new Agents (still capped by Admin)."""
    return {
        'can_view_dashboard': True,
        'can_control_dice': False,
        'can_view_recent_rounds': True,
        'can_view_all_bets': True,
        'can_view_wallets': True,
        'can_view_players': True,
        'can_view_deposit_requests': True,
        'can_view_withdraw_requests': True,
        'can_view_transactions': True,
        'can_view_game_history': True,
        'can_view_game_settings': False,
        'can_view_help_center': False,
        'can_view_white_label': False,
        'can_view_admin_management': False,
        'can_manage_payment_methods': False,
    }


def _admin_default_permissions():
    """Default checklist when Super Admin creates a franchise Admin."""
    return {
        'can_view_dashboard': True,
        'can_control_dice': True,
        'can_view_recent_rounds': True,
        'can_view_all_bets': True,
        'can_view_wallets': True,
        'can_view_players': True,
        'can_view_deposit_requests': True,
        'can_view_withdraw_requests': True,
        'can_view_transactions': True,
        'can_view_game_history': True,
        'can_view_game_settings': False,
        'can_view_help_center': False,
        'can_view_white_label': False,
        'can_view_admin_management': False,
        'can_manage_payment_methods': True,
    }


def _agents_qs_for_actor(actor):
    qs = User.objects.filter(is_staff=True).filter(
        Q(staff_role=User.ROLE_AGENT) | Q(works_under__isnull=False, is_franchise_only=False, is_superuser=False)
    ).exclude(staff_role=User.ROLE_ADMIN).exclude(is_superuser=True)
    if is_super_admin(actor):
        return visible_staff_qs(actor, qs).order_by('-is_active', 'username')
    if is_franchise_admin(actor):
        return qs.filter(works_under=actor).order_by('-is_active', 'username')
    return User.objects.none()


@admin_required
def agent_management(request):
    """List Agents under current Admin (or all for Super Admin)."""
    if not (is_super_admin(request.user) or is_franchise_admin(request.user)):
        messages.error(request, 'Only Admins can manage Agents.')
        return redirect('admin_dashboard')
    if not (is_super_admin(request.user) or has_menu_permission(request.user, 'players')):
        messages.error(request, 'You do not have permission to manage Agents.')
        return redirect('admin_dashboard')

    # Ensure Admin has a referral code for Agents to join
    if is_franchise_admin(request.user) and not request.user.referral_code:
        request.user.referral_code = request.user.generate_unique_referral_code()
        request.user.save(update_fields=['referral_code'])

    agents = _agents_qs_for_actor(request.user)
    q = (request.GET.get('q') or '').strip()
    if q:
        agents = agents.filter(Q(username__icontains=q) | Q(email__icontains=q))

    agent_rows = []
    for a in agents:
        agent_rows.append({
            'user': a,
            'parent': a.works_under,
            'player_count': User.objects.filter(worker=a, is_staff=False).count(),
        })

    context = get_admin_context(request, {
        'page': 'agent-management',
        'agent_rows': agent_rows,
        'search_query': q,
        'referral_code': request.user.referral_code if is_franchise_admin(request.user) else '',
    })
    return render(request, 'admin/agent_management.html', context)


@admin_required
def create_agent(request):
    """Admin (or Super Admin) manually creates an Agent under an Admin."""
    if not (is_super_admin(request.user) or is_franchise_admin(request.user)):
        messages.error(request, 'Only Admins can create Agents.')
        return redirect('admin_dashboard')

    parent_admin = request.user if is_franchise_admin(request.user) else None
    admin_choices = []
    if is_super_admin(request.user):
        admin_choices = list(
            visible_staff_qs(request.user).filter(
                Q(staff_role=User.ROLE_ADMIN) | Q(is_franchise_only=True)
            ).exclude(is_superuser=True).order_by('username')
        )

    granter_perms = get_admin_permissions(request.user if is_franchise_admin(request.user) else request.user)

    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')
        password2 = request.POST.get('password2') or request.POST.get('confirm_password') or ''
        if is_super_admin(request.user):
            parent_id = request.POST.get('parent_admin_id', '').strip()
            try:
                parent_admin = visible_staff_qs(request.user).get(pk=int(parent_id))
            except (ValueError, User.DoesNotExist):
                messages.error(request, 'Select a valid parent Admin.')
                defaults = _agent_default_permissions()
                return render(request, 'admin/create_agent.html', get_admin_context(request, {
                    'page': 'agent-management',
                    'admin_choices': admin_choices,
                    'granter_permissions': granter_perms,
                    'default_permissions': defaults,
                    'permission_items': build_permission_checklist_items(
                        defaults,
                        granter=None,
                        for_agent=True,
                        actor_is_super=is_super_admin(request.user),
                    ),
                }))
        requested = permissions_dict_from_post(request.POST)
        if 'can_view_game_history' not in request.POST:
            requested['can_view_game_history'] = True
        capped = cap_permissions(requested, parent_admin or request.user, for_agent=True)
        if not username or not password:
            messages.error(request, 'Username and password are required.')
        elif password != password2:
            messages.error(request, 'Passwords do not match.')
        elif len(password) < 4:
            messages.error(request, 'Password must be at least 4 characters.')
        elif User.objects.filter(username=username).exists():
            messages.error(request, 'Username already exists.')
        elif not parent_admin:
            messages.error(request, 'Parent Admin is required.')
        else:
            try:
                user = User.objects.create_user(
                    username=username,
                    email=f'{username}@gundu.ata',
                    password=password,
                    is_staff=True,
                    is_superuser=False,
                    is_active=True,
                    is_franchise_only=False,
                    staff_role=User.ROLE_AGENT,
                    works_under=parent_admin,
                )
                if not user.referral_code:
                    user.referral_code = user.generate_unique_referral_code()
                    user.save(update_fields=['referral_code'])
                apply_permissions_to_user(user, capped)
                messages.success(request, f'Agent "{username}" created under Admin "{parent_admin.username}".')
                return redirect('agent_management')
            except Exception as e:
                messages.error(request, f'Error creating agent: {e}')

    defaults = _agent_default_permissions()
    granter_for_ui = parent_admin if is_franchise_admin(request.user) else parent_admin
    context = get_admin_context(request, {
        'page': 'agent-management',
        'admin_choices': admin_choices,
        'granter_permissions': get_admin_permissions(granter_for_ui or request.user),
        'default_permissions': defaults,
        'permission_items': build_permission_checklist_items(
            defaults,
            granter=granter_for_ui,
            for_agent=True,
            actor_is_super=is_super_admin(request.user),
        ),
    })
    return render(request, 'admin/create_agent.html', context)


@admin_required
def edit_agent(request, agent_id):
    """Edit Agent privileges (capped by parent Admin / current Admin)."""
    if not (is_super_admin(request.user) or is_franchise_admin(request.user)):
        messages.error(request, 'Only Admins can edit Agents.')
        return redirect('admin_dashboard')
    try:
        agent = visible_staff_qs(request.user).get(pk=agent_id)
    except User.DoesNotExist:
        messages.error(request, 'Agent not found.')
        return redirect('agent_management')
    if is_franchise_admin(request.user) and agent.works_under_id != request.user.id:
        messages.error(request, 'You can only edit Agents under you.')
        return redirect('agent_management')
    if is_super_admin(agent) or is_franchise_admin(agent):
        messages.error(request, 'Not an Agent account.')
        return redirect('agent_management')

    parent = agent.works_under or request.user
    try:
        permissions = AdminPermissions.objects.get(user=agent)
    except AdminPermissions.DoesNotExist:
        permissions = AdminPermissions.objects.create(user=agent)

    if request.method == 'POST':
        requested = permissions_dict_from_post(request.POST)
        if 'can_view_game_history' not in request.POST:
            requested['can_view_game_history'] = True
        granter = parent if is_franchise_admin(parent) else request.user
        capped = cap_permissions(requested, granter, for_agent=True)
        apply_permissions_to_user(agent, capped)
        sync_staff_flags(agent, User.ROLE_AGENT)
        agent.works_under = parent
        new_password = request.POST.get('new_password', '')
        if new_password:
            password2 = request.POST.get('password2') or ''
            if new_password == password2:
                agent.set_password(new_password)
            else:
                messages.error(request, 'Passwords do not match.')
                return redirect('edit_agent', agent_id=agent.id)
        agent.is_active = request.POST.get('is_active') == 'on'
        agent.save()
        messages.success(request, f'Agent "{agent.username}" updated.')
        return redirect('agent_management')

    granter_for_ui = parent if is_franchise_admin(parent) else (request.user if is_franchise_admin(request.user) else parent)
    context = get_admin_context(request, {
        'page': 'agent-management',
        'agent_user': agent,
        'permissions': permissions,
        'granter_permissions': get_admin_permissions(granter_for_ui),
        'parent_admin': parent,
        'permission_items': build_permission_checklist_items(
            permissions,
            granter=granter_for_ui,
            for_agent=True,
            actor_is_super=is_super_admin(request.user),
        ),
    })
    return render(request, 'admin/edit_agent.html', context)


@admin_required
def toggle_agent_status(request, agent_id):
    if request.method != 'POST':
        return redirect('agent_management')
    if not (is_super_admin(request.user) or is_franchise_admin(request.user)):
        messages.error(request, 'Only Admins can toggle Agents.')
        return redirect('admin_dashboard')
    try:
        agent = visible_staff_qs(request.user).get(pk=agent_id)
    except User.DoesNotExist:
        messages.error(request, 'Agent not found.')
        return redirect('agent_management')
    if is_franchise_admin(request.user) and agent.works_under_id != request.user.id:
        messages.error(request, 'You can only manage Agents under you.')
        return redirect('agent_management')
    agent.is_active = not agent.is_active
    agent.save(update_fields=['is_active'])
    messages.success(request, f'Agent "{agent.username}" {"activated" if agent.is_active else "deactivated"}.')
    return redirect('agent_management')

