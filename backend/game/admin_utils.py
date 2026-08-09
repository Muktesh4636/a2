from functools import wraps
from django.shortcuts import redirect
from django.contrib import messages
from django.core.cache import cache
from django.db.models import Q

# Cache TTL for admin permissions (reduces DB hits on every admin page load; helps avoid 504)
ADMIN_PERMS_CACHE_TTL = 60
ADMIN_PERMS_CACHE_KEY_PREFIX = 'admin_perms_'

# Flags Agents must never receive (Super Admin only)
SUPER_ONLY_PERMISSION_FIELDS = (
    'can_view_game_settings',
    'can_view_admin_management',
    'can_view_white_label',
)

PERMISSION_FIELD_NAMES = (
    'can_view_dashboard',
    'can_control_dice',
    'can_view_recent_rounds',
    'can_view_all_bets',
    'can_view_wallets',
    'can_view_players',
    'can_view_deposit_requests',
    'can_view_withdraw_requests',
    'can_view_transactions',
    'can_view_game_history',
    'can_view_game_settings',
    'can_view_help_center',
    'can_view_white_label',
    'can_view_admin_management',
    'can_manage_payment_methods',
)

# Labels for privilege checklists (Admin + Agent UI)
PERMISSION_FIELD_LABELS = {
    'can_view_dashboard': '📊 Dashboard',
    'can_control_dice': '🎯 Dice Control',
    'can_view_recent_rounds': '🔄 Recent games (inside Games)',
    'can_view_all_bets': '💰 All Bets',
    'can_view_wallets': '💳 Wallets',
    'can_view_players': '👥 Players',
    'can_view_deposit_requests': '📥 Deposit Requests',
    'can_view_withdraw_requests': '💸 Withdraw Requests',
    'can_view_transactions': '📋 Reports',
    'can_view_game_history': '📜 Game History',
    'can_view_game_settings': '⚙️ App Settings',
    'can_view_help_center': '🆘 Help Center',
    'can_view_white_label': '💬 White Label Messages',
    'can_view_admin_management': '👨‍💼 Admin Management',
    'can_manage_payment_methods': '🏦 Payment Methods',
}


def build_permission_checklist_items(current_perms=None, granter=None, for_agent=False, actor_is_super=False):
    """
    Full privilege checklist for templates.
    Always returns every AdminPermissions flag so the UI never hides options.
    Non-grantable items stay visible but disabled.
    """
    current = current_perms or {}
    # Super Admin editing an Admin: uncapped full checklist
    admin_uncapped = (not for_agent) and (actor_is_super or (granter is not None and is_super_admin(granter)))

    if for_agent:
        if granter is not None and is_franchise_admin(granter):
            granter_perms = get_admin_permissions(granter)
            mode = 'cap_by_admin'
        elif granter is not None and is_super_admin(granter):
            granter_perms = None
            mode = 'all_except_super'
        elif actor_is_super and granter is None:
            granter_perms = None
            mode = 'all_except_super'
        else:
            granter_perms = get_admin_permissions(granter) if granter else None
            mode = 'cap_by_admin'
    else:
        granter_perms = None
        mode = 'uncapped' if admin_uncapped else 'cap_by_admin'
        if mode == 'cap_by_admin' and granter is not None:
            granter_perms = get_admin_permissions(granter)

    items = []
    for name in PERMISSION_FIELD_NAMES:
        if hasattr(current, name) and not isinstance(current, dict):
            checked = bool(getattr(current, name, False))
        elif isinstance(current, dict):
            checked = bool(current.get(name, False))
        else:
            checked = False

        super_only = name in SUPER_ONLY_PERMISSION_FIELDS
        if for_agent and super_only:
            grantable, hint = False, 'Agents cannot have this'
            checked = False
        elif mode == 'uncapped':
            grantable, hint = True, ''
        elif mode == 'all_except_super':
            grantable, hint = True, ''
        else:
            grantable = bool(getattr(granter_perms, name, False)) if granter_perms else False
            hint = '' if grantable else 'Not in your privileges'

        items.append({
            'name': name,
            'label': PERMISSION_FIELD_LABELS.get(name, name),
            'checked': bool(checked) and grantable,
            'disabled': not grantable,
            'show': True,
            'hint': hint,
        })
    return items


class _CachedPermissions:
    """Thin wrapper so has_menu_permission can use getattr(perms, field_name)."""
    __slots__ = ('_data',)

    def __init__(self, data):
        self._data = data or {}

    def __getattr__(self, name):
        return self._data.get(name, False)


def is_staff(user):
    """Check if user is staff"""
    return user.is_authenticated and user.is_staff


def is_god(user):
    """God Admin — top of the hierarchy. Only God may manage Super Admins."""
    if not user or not user.is_authenticated:
        return False
    return getattr(user, 'staff_role', None) == 'GOD'


def is_super_admin(user):
    """
    Super Admin privileges. God is a superset of Super Admin, so it passes too.
    Super Admins keep full visibility; God additionally manages Super Admins.
    """
    if not user or not user.is_authenticated:
        return False
    if is_god(user):
        return True
    if user.is_superuser:
        return True
    return getattr(user, 'staff_role', None) == 'SUPER_ADMIN'


def is_franchise_admin(user):
    """Franchise Admin (created by Super Admin)."""
    if not user or not user.is_authenticated:
        return False
    if is_super_admin(user):
        return False
    role = getattr(user, 'staff_role', None)
    if role == 'ADMIN':
        return True
    # Legacy: franchise_only staff without migrated role
    return bool(user.is_staff and getattr(user, 'is_franchise_only', False) and role != 'AGENT')


def is_agent(user):
    """Agent under an Admin."""
    if not user or not user.is_authenticated:
        return False
    if is_super_admin(user) or is_franchise_admin(user):
        return False
    role = getattr(user, 'staff_role', None)
    if role == 'AGENT':
        return True
    # Legacy workers: staff with works_under, not franchise
    return bool(
        user.is_staff
        and not getattr(user, 'is_franchise_only', False)
        and getattr(user, 'works_under_id', None)
    )


def role_of(user):
    """Normalised hierarchy role for any account."""
    if not user or not getattr(user, 'is_authenticated', True):
        return None
    if is_god(user):
        return 'GOD'
    if is_super_admin(user):
        return 'SUPER_ADMIN'
    if is_franchise_admin(user):
        return 'ADMIN'
    if is_agent(user):
        return 'AGENT'
    return 'PLAYER'


# Each role may create exactly the level directly beneath it, plus players.
# Players may sit under any staff level except God.
CREATABLE_ROLES = {
    'GOD': ('SUPER_ADMIN', 'ADMIN', 'AGENT', 'PLAYER'),
    'SUPER_ADMIN': ('ADMIN', 'AGENT', 'PLAYER'),
    'ADMIN': ('AGENT', 'PLAYER'),
    'AGENT': ('PLAYER',),
    'PLAYER': (),
}

# Staff parent one level up for each staff role.
PARENT_ROLE = {
    'SUPER_ADMIN': 'GOD',
    'ADMIN': 'SUPER_ADMIN',
    'AGENT': 'ADMIN',
}

# A player's owner (worker) may be any staff role except God.
PLAYER_OWNER_ROLES = ('SUPER_ADMIN', 'ADMIN', 'AGENT')


def can_create_role(actor, role):
    """True when `actor` is allowed to create an account with `role`."""
    return role in CREATABLE_ROLES.get(role_of(actor) or 'PLAYER', ())


def can_manage_super_admins(actor):
    """Only God creates, edits, or deletes Super Admins."""
    return is_god(actor)


def can_be_player_owner(owner):
    """Players may be owned by Super Admin, Admin, or Agent — never God."""
    return role_of(owner) in PLAYER_OWNER_ROLES


def hide_god_from(actor, qs):
    """
    The God account is confidential: it must not appear in any staff listing,
    owner dropdown, or franchise table shown to a non-God user.
    """
    if is_god(actor):
        return qs
    return qs.exclude(staff_role='GOD')


def sees_all_data(actor):
    """
    Only God sees the whole platform. Every other role — including Super Admin —
    is confined to its own subtree.
    """
    return is_god(actor)


# Hierarchy is God→Super Admin→Admin→Agent, so four hops covers it. The cap only
# guards against a works_under cycle created by bad data.
_MAX_HIERARCHY_DEPTH = 6


def staff_subtree_ids(actor, include_self=True):
    """
    PKs of every staff account at or below `actor`, walking `works_under` downward.

    Used for data scoping: a Super Admin's subtree is its Admins plus their
    Agents, an Admin's is its Agents, an Agent's is just itself.
    """
    if not actor or not getattr(actor, 'is_authenticated', False):
        return []
    from accounts.models import User as UserModel

    seen = {actor.id}
    frontier = [actor.id]
    for _ in range(_MAX_HIERARCHY_DEPTH):
        if not frontier:
            break
        children = list(
            UserModel.objects.filter(is_staff=True, works_under_id__in=frontier)
            .exclude(id__in=seen)
            .values_list('id', flat=True)
        )
        if not children:
            break
        seen.update(children)
        frontier = children

    if not include_self:
        seen.discard(actor.id)
    return list(seen)


def visible_staff_qs(actor, base_qs=None):
    """Staff accounts `actor` may see: God gets everyone, others get their subtree."""
    from accounts.models import User as UserModel
    qs = base_qs if base_qs is not None else UserModel.objects.filter(is_staff=True)
    if sees_all_data(actor):
        return qs
    return hide_god_from(actor, qs.filter(id__in=staff_subtree_ids(actor)))


def get_franchise_admin(user):
    """
    Resolve the franchise Admin for wallet / tree:
    - Agent → parent Admin (works_under)
    - Admin → self
    - Super Admin → self
    - Player → walk worker → franchise admin
    """
    if not user:
        return None
    from accounts.models import User as UserModel

    if is_super_admin(user):
        return user
    if is_franchise_admin(user):
        return user
    if is_agent(user):
        parent_id = getattr(user, 'works_under_id', None)
        if parent_id:
            try:
                return UserModel.objects.get(pk=parent_id)
            except UserModel.DoesNotExist:
                return None
        return None
    # Player: ownership parent may be Admin or Agent
    owner_id = getattr(user, 'worker_id', None)
    if not owner_id:
        return None
    try:
        owner = UserModel.objects.get(pk=owner_id)
    except UserModel.DoesNotExist:
        return None
    return get_franchise_admin(owner)


def get_effective_admin(user):
    """
    Backward-compatible: for Agents return parent Admin; else self.
    Prefer get_scoped_player_qs / get_franchise_admin for new code.
    """
    if not user or not user.is_authenticated:
        return user
    if is_agent(user):
        fa = get_franchise_admin(user)
        return fa or user
    return user


def agent_ids_under_admin(admin_user):
    """PKs of Agents whose parent_admin is this Admin."""
    if not admin_user:
        return []
    from accounts.models import User as UserModel
    return list(
        UserModel.objects.filter(
            is_staff=True,
            works_under_id=admin_user.id,
            is_superuser=False,
            is_franchise_only=False,
        ).filter(
            Q(staff_role='AGENT') | Q(staff_role='') | Q(staff_role='PLAYER')
        ).values_list('id', flat=True)
    )


def get_scoped_player_qs(actor, base_qs=None):
    """
    Players visible to actor:
    - God → all non-staff players
    - Super Admin → players owned by itself, its Admins, or their Agents
    - Admin → players owned by Admin or any Agent under Admin
    - Agent → players owned by self
    """
    from accounts.models import User as UserModel
    qs = base_qs if base_qs is not None else UserModel.objects.filter(is_staff=False)
    if not actor or not actor.is_authenticated:
        return qs.none()
    if sees_all_data(actor):
        return qs
    owner_ids = staff_subtree_ids(actor)
    if not owner_ids:
        return qs.none()
    return qs.filter(worker_id__in=owner_ids)


def scope_by_player_owner(actor, qs, user_field='user'):
    """Filter a queryset of objects that have a FK to player User."""
    if sees_all_data(actor):
        return qs
    players = get_scoped_player_qs(actor)
    return qs.filter(**{f'{user_field}__in': players})


def is_admin(user):
    """Any staff who can access the admin panel (God, Super Admin, Admin, Agent)."""
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_staff:
        return True
    role = getattr(user, 'staff_role', None)
    return role in ('GOD', 'SUPER_ADMIN', 'ADMIN', 'AGENT')


def has_permission(user, permission_name):
    """Map legacy names onto menu permissions."""
    if not user.is_authenticated:
        return False
    if is_super_admin(user):
        return True
    legacy_map = {
        'view_dashboard': 'dashboard',
        'control_dice': 'dice_control',
        'manage_users': 'players',
        'manage_deposits': 'deposit_requests',
    }
    return has_menu_permission(user, legacy_map.get(permission_name, permission_name))


def get_admin_profile(user):
    """Deprecated — AdminProfile removed."""
    return None


def _perms_to_dict(perms):
    """Build a dict of permission flags for caching."""
    return {name: getattr(perms, name, False) for name in PERMISSION_FIELD_NAMES}


def get_admin_permissions(user):
    """Get admin permissions for user. Cached 60s per user to reduce DB load and 504 risk."""
    if not user.is_authenticated:
        return None
    cache_key = ADMIN_PERMS_CACHE_KEY_PREFIX + str(user.id)
    try:
        cached = cache.get(cache_key)
        if cached is not None:
            return _CachedPermissions(cached)
    except Exception:
        pass
    from .models import AdminPermissions
    try:
        perms = AdminPermissions.objects.get(user=user)
    except AdminPermissions.DoesNotExist:
        if user.is_staff:
            perms = AdminPermissions.objects.create(user=user)
        else:
            return None
    try:
        cache.set(cache_key, _perms_to_dict(perms), ADMIN_PERMS_CACHE_TTL)
    except Exception:
        pass
    return perms


def permissions_dict_from_post(post_data, defaults=None):
    """Build permission field dict from checkbox POST (on = True)."""
    result = {}
    for name in PERMISSION_FIELD_NAMES:
        if defaults and name in defaults and name not in post_data:
            # keep default only when explicitly using defaults for missing keys
            pass
        result[name] = post_data.get(name) == 'on'
    return result


def cap_permissions(requested, granter, for_agent=False):
    """
    AND each requested flag with granter's AdminPermissions.
    Super Admin granter → uncapped (except Agent still cannot get SUPER_ONLY flags).
    """
    requested = dict(requested or {})
    if for_agent:
        for name in SUPER_ONLY_PERMISSION_FIELDS:
            requested[name] = False

    if granter is None:
        return {name: False for name in PERMISSION_FIELD_NAMES}

    if is_super_admin(granter) and not for_agent:
        # Super Admin granting to Admin: use requested as-is
        return {name: bool(requested.get(name, False)) for name in PERMISSION_FIELD_NAMES}

    if is_super_admin(granter) and for_agent:
        return {name: bool(requested.get(name, False)) for name in PERMISSION_FIELD_NAMES}

    granter_perms = get_admin_permissions(granter)
    capped = {}
    for name in PERMISSION_FIELD_NAMES:
        want = bool(requested.get(name, False))
        allowed = bool(getattr(granter_perms, name, False)) if granter_perms else False
        if for_agent and name in SUPER_ONLY_PERMISSION_FIELDS:
            capped[name] = False
        else:
            capped[name] = want and allowed
    return capped


def apply_permissions_to_user(target_user, perms_dict):
    """Create/update AdminPermissions from a dict of field→bool."""
    from .models import AdminPermissions
    obj, _ = AdminPermissions.objects.get_or_create(user=target_user)
    for name in PERMISSION_FIELD_NAMES:
        if name in perms_dict:
            setattr(obj, name, bool(perms_dict[name]))
    obj.save()
    invalidate_admin_permissions_cache(target_user)
    return obj


def has_menu_permission(user, permission_name):
    """Check if user has permission to view a menu item"""
    if is_super_admin(user):
        return True

    perms = get_admin_permissions(user)
    if not perms:
        return False

    permission_map = {
        'dashboard': 'can_view_dashboard',
        'games': 'can_view_dashboard',
        'dice_control': 'can_control_dice',
        'recent_rounds': 'can_view_recent_rounds',
        'all_bets': 'can_view_all_bets',
        'wallets': 'can_view_wallets',
        'players': 'can_view_players',
        'deposit_requests': 'can_view_deposit_requests',
        'withdraw_requests': 'can_view_withdraw_requests',
        'transactions': 'can_view_transactions',
        'game_history': 'can_view_game_history',
        'game_settings': 'can_view_game_settings',
        'help_center': 'can_view_help_center',
        'white_label': 'can_view_white_label',
        'admin_management': 'can_view_admin_management',
        'agent_management': 'can_view_players',  # Agents list for Admins who can see players
        'payment_methods': 'can_manage_payment_methods',
    }

    field_name = permission_map.get(permission_name)
    if not field_name:
        return False

    return getattr(perms, field_name, False)


def invalidate_admin_permissions_cache(user):
    """Call after creating/updating AdminPermissions for a user so next request sees fresh perms."""
    if user is None:
        return
    try:
        cache.delete(ADMIN_PERMS_CACHE_KEY_PREFIX + str(user.id))
    except Exception:
        pass


def sync_staff_flags(user, role, parent=None):
    """
    Keep is_staff / is_superuser / is_franchise_only aligned with staff_role.

    `parent` is the staff account one level up (Super Admin→God, Admin→Super Admin,
    Agent→Admin). Pass None to leave any existing parent untouched; God always
    has no parent.
    """
    user.staff_role = role
    if role == 'GOD':
        user.is_staff = True
        user.is_superuser = True
        user.is_franchise_only = False
        user.works_under = None
    elif role == 'SUPER_ADMIN':
        user.is_staff = True
        user.is_superuser = True
        user.is_franchise_only = False
        if parent is not None:
            user.works_under = parent
    elif role == 'ADMIN':
        user.is_staff = True
        user.is_superuser = False
        user.is_franchise_only = True
        if parent is not None:
            user.works_under = parent
    elif role == 'AGENT':
        user.is_staff = True
        user.is_superuser = False
        user.is_franchise_only = False
        if parent is not None:
            user.works_under = parent
    else:
        user.is_staff = False
        user.is_superuser = False
        user.is_franchise_only = False
        user.works_under = None


def admin_required(view_func):
    """Decorator to require admin access"""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        try:
            if not request.user.is_authenticated:
                from django.http import HttpResponseRedirect
                from django.urls import reverse
                try:
                    login_url = reverse('admin_login')
                except Exception:
                    login_url = '/game-admin/login/'
                next_url = request.get_full_path()
                return HttpResponseRedirect(f'{login_url}?next={next_url}')
            if not is_admin(request.user):
                messages.error(request, 'You do not have permission to access this page.')
                return redirect('admin_login')
            return view_func(request, *args, **kwargs)
        except Exception as e:
            import traceback
            traceback.print_exc()
            messages.error(request, f'Permission Error: {str(e)}')
            return redirect('admin_login')
    return wrapper


def god_required(view_func):
    """Decorator to require God access (managing Super Admins)."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect('admin_login')
        if not is_god(request.user):
            messages.error(request, 'Only the God Admin can access this page.')
            return redirect('admin_dashboard')
        return view_func(request, *args, **kwargs)
    return wrapper


def super_admin_required(view_func):
    """Decorator to require Super Admin access"""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect('admin_login')
        if not is_super_admin(request.user):
            messages.error(request, 'You do not have permission to access this page.')
            return redirect('admin_dashboard')
        return view_func(request, *args, **kwargs)
    return wrapper


def franchise_admin_required(view_func):
    """Decorator: Super Admin or franchise Admin (not Agent)."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect('admin_login')
        if not (is_super_admin(request.user) or is_franchise_admin(request.user)):
            messages.error(request, 'Only Admins can access this page.')
            return redirect('admin_dashboard')
        return view_func(request, *args, **kwargs)
    return wrapper


def permission_required(permission_name):
    """Decorator factory to require specific menu permission"""
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            if not has_menu_permission(request.user, permission_name):
                messages.error(request, 'You do not have permission to access this page.')
                return redirect('admin_dashboard')
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator
