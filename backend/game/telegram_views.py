"""
Telegram bot webhook.

Public endpoint (Telegram calls it), protected by an unguessable secret in the
URL path. It only understands the few commands needed to link, pause, and
unlink an admin account.
"""
import json
import logging

from django.http import JsonResponse, HttpResponseForbidden
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from . import telegram_utils as tg
from .models import AdminTelegramLink

logger = logging.getLogger(__name__)

HELP_TEXT = (
    'Commands:\n'
    '/start &lt;code&gt; — connect your admin account\n'
    '/status — show connection status\n'
    '/stop — pause login alerts\n'
    '/resume — resume login alerts\n'
    '/unlink — disconnect this chat'
)


def _reply(chat_id, text):
    tg.send_message(chat_id, text)
    return JsonResponse({'ok': True})


@csrf_exempt
@require_POST
def telegram_webhook(request, secret):
    expected = tg.get_webhook_secret()
    if not expected or secret != expected:
        return HttpResponseForbidden('forbidden')

    try:
        update = json.loads(request.body.decode('utf-8') or '{}')
    except Exception:
        return JsonResponse({'ok': True})

    message = update.get('message') or update.get('edited_message') or {}
    chat = message.get('chat') or {}
    chat_id = chat.get('id')
    text = (message.get('text') or '').strip()
    if not chat_id or not text:
        return JsonResponse({'ok': True})

    sender = message.get('from') or {}
    tg_username = (sender.get('username') or '').strip()
    parts = text.split()
    command = parts[0].lower().split('@')[0]

    if command == '/start':
        code = parts[1].strip() if len(parts) > 1 else ''
        if not code:
            return _reply(
                chat_id,
                'Open your admin panel → Profile → Telegram alerts and tap '
                '<b>Connect Telegram</b>. That link carries your personal code.',
            )
        link = AdminTelegramLink.objects.filter(link_code=code).select_related('user').first()
        if not link:
            return _reply(chat_id, '❌ That code is not valid. Generate a fresh one from your admin profile.')
        # A code belongs to exactly one account; re-linking just moves the chat.
        AdminTelegramLink.objects.filter(chat_id=str(chat_id)).exclude(pk=link.pk).update(
            chat_id='', linked_at=None
        )
        link.chat_id = str(chat_id)
        link.telegram_username = tg_username[:64]
        link.enabled = True
        link.linked_at = timezone.now()
        link.last_error = ''
        link.save(update_fields=[
            'chat_id', 'telegram_username', 'enabled', 'linked_at', 'last_error', 'updated_at',
        ])
        return _reply(
            chat_id,
            f'✅ Connected to admin account <b>{link.user.username}</b>.\n\n'
            'You will get a message here every time this account signs in to the '
            'admin panel.\n\nSend /stop to pause alerts.',
        )

    link = AdminTelegramLink.objects.filter(chat_id=str(chat_id)).select_related('user').first()

    if command == '/status':
        if not link:
            return _reply(chat_id, 'This chat is not connected to any admin account.')
        state = 'on' if link.enabled else 'paused'
        return _reply(
            chat_id,
            f'Account: <b>{link.user.username}</b>\nLogin alerts: <b>{state}</b>',
        )

    if command in ('/stop', '/resume'):
        if not link:
            return _reply(chat_id, 'This chat is not connected to any admin account.')
        link.enabled = command == '/resume'
        link.save(update_fields=['enabled', 'updated_at'])
        return _reply(
            chat_id,
            '🔕 Login alerts paused. Send /resume to turn them back on.'
            if not link.enabled else '🔔 Login alerts resumed.',
        )

    if command == '/unlink':
        if not link:
            return _reply(chat_id, 'This chat is not connected to any admin account.')
        username = link.user.username
        link.chat_id = ''
        link.linked_at = None
        link.save(update_fields=['chat_id', 'linked_at', 'updated_at'])
        return _reply(chat_id, f'🔌 Disconnected from <b>{username}</b>.')

    return _reply(chat_id, HELP_TEXT)
