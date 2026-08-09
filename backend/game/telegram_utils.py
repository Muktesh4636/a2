"""
Telegram login alerts for the admin panel.

Each admin links their own account to the bot once; from then on every
successful sign-in sends that person a private message. Alerts are advisory
only — nothing here may ever block or slow down a login, so all sending happens
on a background thread with a short timeout and every failure is swallowed.
"""
import html
import logging
import secrets
import threading
from datetime import timedelta

import requests
from django.utils import timezone

logger = logging.getLogger(__name__)

API_BASE = 'https://api.telegram.org'
SEND_TIMEOUT_S = 6
# A burst of sign-ins shouldn't spam the same chat.
ALERT_COOLDOWN_S = 0

SETTING_BOT_TOKEN = 'TELEGRAM_BOT_TOKEN'
SETTING_BOT_USERNAME = 'TELEGRAM_BOT_USERNAME'
SETTING_WEBHOOK_SECRET = 'TELEGRAM_WEBHOOK_SECRET'
SETTING_ALERTS_ENABLED = 'TELEGRAM_LOGIN_ALERTS'


def _setting(key, default=''):
    from .utils import get_game_setting
    try:
        return str(get_game_setting(key, default) or default).strip()
    except Exception:
        return default


def get_bot_token():
    return _setting(SETTING_BOT_TOKEN)


def get_bot_username():
    return _setting(SETTING_BOT_USERNAME).lstrip('@')


def get_webhook_secret():
    return _setting(SETTING_WEBHOOK_SECRET)


def alerts_enabled():
    """Master switch; defaults to on once a bot token exists."""
    raw = _setting(SETTING_ALERTS_ENABLED, 'on').lower()
    return raw not in ('off', '0', 'false', 'no')


def is_configured():
    return bool(get_bot_token())


def ensure_webhook_secret():
    """Create the webhook secret on first use so the URL is never guessable."""
    from .models import GameSettings
    from .utils import clear_game_setting_cache

    secret = get_webhook_secret()
    if secret:
        return secret
    secret = secrets.token_urlsafe(32)
    GameSettings.objects.update_or_create(
        key=SETTING_WEBHOOK_SECRET,
        defaults={
            'value': secret,
            'description': 'Secret path segment for the Telegram bot webhook',
        },
    )
    clear_game_setting_cache([SETTING_WEBHOOK_SECRET])
    return secret


def send_message(chat_id, text, parse_mode='HTML'):
    """
    Send one message. Returns (ok, error_string). Never raises.
    """
    token = get_bot_token()
    if not token:
        return False, 'bot token not configured'
    if not chat_id:
        return False, 'no chat id'
    try:
        resp = requests.post(
            f'{API_BASE}/bot{token}/sendMessage',
            json={
                'chat_id': str(chat_id),
                'text': text,
                'parse_mode': parse_mode,
                'disable_web_page_preview': True,
            },
            timeout=SEND_TIMEOUT_S,
        )
        payload = {}
        try:
            payload = resp.json()
        except Exception:
            pass
        if resp.status_code == 200 and payload.get('ok'):
            return True, ''
        return False, str(payload.get('description') or f'HTTP {resp.status_code}')[:300]
    except Exception as exc:
        return False, str(exc)[:300]


def get_or_create_link(user):
    """Fetch (or lazily create) the Telegram link row for an admin account."""
    from .models import AdminTelegramLink

    link = AdminTelegramLink.objects.filter(user=user).first()
    if link:
        if not link.link_code:
            link.link_code = secrets.token_urlsafe(12)
            link.save(update_fields=['link_code', 'updated_at'])
        return link
    for _ in range(5):
        code = secrets.token_urlsafe(12)
        if not AdminTelegramLink.objects.filter(link_code=code).exists():
            return AdminTelegramLink.objects.create(user=user, link_code=code)
    return AdminTelegramLink.objects.create(user=user, link_code=secrets.token_urlsafe(24))


def build_connect_url(link):
    """Deep link that opens the bot and pre-fills `/start <code>`."""
    bot = get_bot_username()
    if not bot or not link:
        return ''
    return f'https://t.me/{bot}?start={link.link_code}'


def client_ip(request):
    fwd = (request.META.get('HTTP_X_FORWARDED_FOR') or '').strip()
    if fwd:
        return fwd.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '') or 'unknown'


def _short_user_agent(raw):
    """Best-effort readable device string from a User-Agent header."""
    ua = (raw or '').strip()
    if not ua:
        return 'unknown device'
    if 'Android' in ua:
        platform = 'Android'
    elif 'iPhone' in ua or 'iPad' in ua:
        platform = 'iPhone/iPad'
    elif 'Windows' in ua:
        platform = 'Windows'
    elif 'Mac OS X' in ua or 'Macintosh' in ua:
        platform = 'Mac'
    elif 'Linux' in ua:
        platform = 'Linux'
    else:
        platform = 'unknown OS'
    if 'Edg/' in ua:
        browser = 'Edge'
    elif 'OPR/' in ua or 'Opera' in ua:
        browser = 'Opera'
    elif 'Chrome/' in ua:
        browser = 'Chrome'
    elif 'Firefox/' in ua:
        browser = 'Firefox'
    elif 'Safari/' in ua:
        browser = 'Safari'
    else:
        browser = 'unknown browser'
    return f'{browser} on {platform}'


def _ist_now_string():
    ist = timezone.now() + timedelta(hours=5, minutes=30)
    return ist.strftime('%d %b %Y, %I:%M %p') + ' IST'


def build_login_message(user, role_label, ip, device):
    esc = html.escape
    return (
        '🔐 <b>Admin panel sign-in</b>\n\n'
        f'👤 <b>Account:</b> {esc(user.username)}\n'
        f'🏷️ <b>Role:</b> {esc(role_label)}\n'
        f'🕒 <b>Time:</b> {esc(_ist_now_string())}\n'
        f'🌐 <b>IP:</b> {esc(ip)}\n'
        f'💻 <b>Device:</b> {esc(device)}\n\n'
        'If this was not you, change your password immediately.'
    )


def _deliver(link_id, text):
    """Runs on a worker thread; must never propagate an exception."""
    from .models import AdminTelegramLink
    try:
        link = AdminTelegramLink.objects.filter(pk=link_id).first()
        if not link or not link.chat_id:
            return
        ok, err = send_message(link.chat_id, text)
        fields = ['updated_at']
        if ok:
            link.last_alert_at = timezone.now()
            link.last_error = ''
            fields += ['last_alert_at', 'last_error']
        else:
            link.last_error = err
            fields += ['last_error']
            logger.warning('telegram alert failed for %s: %s', link.user_id, err)
        link.save(update_fields=fields)
    except Exception as exc:
        logger.warning('telegram alert thread error: %s', exc)


def notify_login(user, request, role_label='Admin'):
    """
    Fire-and-forget login alert. Safe to call from inside the login view: it
    returns immediately and any failure is contained.
    """
    try:
        if not alerts_enabled() or not is_configured():
            return
        from .admin_utils import is_god
        # God's own sign-ins stay silent by design.
        if is_god(user):
            return
        from .models import AdminTelegramLink
        link = AdminTelegramLink.objects.filter(user=user, enabled=True).first()
        if not link or not link.chat_id:
            return
        if ALERT_COOLDOWN_S and link.last_alert_at:
            age = (timezone.now() - link.last_alert_at).total_seconds()
            if age < ALERT_COOLDOWN_S:
                return
        text = build_login_message(
            user,
            role_label,
            client_ip(request),
            _short_user_agent(request.META.get('HTTP_USER_AGENT')),
        )
        threading.Thread(target=_deliver, args=(link.id, text), daemon=True).start()
    except Exception as exc:
        logger.warning('notify_login skipped: %s', exc)


def set_webhook(base_url):
    """Register the webhook with Telegram. Returns (ok, message)."""
    token = get_bot_token()
    if not token:
        return False, 'bot token not configured'
    secret = ensure_webhook_secret()
    url = f"{base_url.rstrip('/')}/api/telegram/webhook/{secret}/"
    try:
        resp = requests.post(
            f'{API_BASE}/bot{token}/setWebhook',
            json={'url': url, 'allowed_updates': ['message']},
            timeout=SEND_TIMEOUT_S,
        )
        payload = resp.json()
        if payload.get('ok'):
            return True, url
        return False, str(payload.get('description') or resp.text)[:300]
    except Exception as exc:
        return False, str(exc)[:300]


def get_bot_info():
    """Return (ok, info_dict_or_error) for the configured token."""
    token = get_bot_token()
    if not token:
        return False, 'bot token not configured'
    try:
        resp = requests.get(f'{API_BASE}/bot{token}/getMe', timeout=SEND_TIMEOUT_S)
        payload = resp.json()
        if payload.get('ok'):
            return True, payload.get('result') or {}
        return False, str(payload.get('description') or resp.text)[:300]
    except Exception as exc:
        return False, str(exc)[:300]
