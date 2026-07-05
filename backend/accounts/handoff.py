"""
One-time handoff codes for trusted servers (e.g. Cock Fight backend) → Gundu Ata JWT.

Flow:
1. POST /api/auth/handoff/create/  (header X-Handoff-Secret + body phone_number)
2. POST /api/auth/handoff/exchange/ { "code": "..." }  → { access, refresh, user }
"""
import json
import logging
import secrets
import uuid
from typing import Optional

from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from rest_framework import status
from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User, Wallet, FranchiseBalance
from .serializers import UserSerializer
from game.utils import get_redis_client
from .views import _set_single_session

logger = logging.getLogger('accounts')

redis_client = get_redis_client()

HANDOFF_REDIS_PREFIX = 'gundu_handoff_code:'


def _base_username(clean_phone: str) -> str:
    p = (clean_phone or '').strip()[:20]
    return f'cf_{p}' or 'cf_user'


def _get_or_create_player_by_phone(clean_phone: str, create_if_missing: bool, request_data: dict) -> Optional[User]:
    user = User.objects.filter(phone_number=clean_phone).first()
    if user is not None:
        return user
    if not create_if_missing:
        return None

    base = _base_username(clean_phone)
    uname = base
    n = 0
    while User.objects.filter(username=uname).exists():
        n += 1
        uname = f'{base}_{n}'

    with transaction.atomic():
        pw = secrets.token_urlsafe(32)
        user = User.objects.create_user(username=uname, email='', password=pw)
        user.set_unusable_password()
        user.phone_number = clean_phone
        user.save()

        package = (request_data.get('package') or request_data.get('package_name') or '').strip()
        if package:
            fb = FranchiseBalance.objects.filter(package_name=package).first()
            if fb:
                user.worker = fb.user
                user.save(update_fields=['worker_id'])
                logger.info('Handoff: linked new user to franchise by package %s', package)

        Wallet.objects.get_or_create(user=user, defaults={'balance': Decimal('0.00')})
        if redis_client:
            try:
                redis_client.set(f'user_balance:{user.id}', '0.00', ex=86400)
            except Exception as e:
                logger.warning('Handoff: redis balance set skipped: %s', e)
    return user


def _sync_session_after_login(user):
    if not redis_client:
        return
    try:
        wallet_obj, _ = Wallet.objects.get_or_create(user=user)
        pipe = redis_client.pipeline()
        pipe.set(f'user_balance:{user.id}', str(wallet_obj.balance), ex=86400)
        user_session_data = {
            'id': user.id,
            'username': user.username,
            'is_staff': user.is_staff,
            'is_active': user.is_active,
            'wallet_balance': str(wallet_obj.balance),
        }
        pipe.set(f'user_session:{user.id}', json.dumps(user_session_data), ex=3600)
        pipe.execute()
    except Exception as e:
        logger.error('Handoff: Redis sync error: %s', e)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@csrf_exempt
def handoff_create(request):
    """
    Create a one-time code bound to a Gundu Ata user (get-or-create by phone).
    Secured with X-Handoff-Secret (shared with Cock Fight backend only).
    """
    secret = getattr(settings, 'HANDOFF_CREATE_SECRET', None) or ''
    if not secret:
        return Response(
            {'error': 'Handoff is not configured (HANDOFF_CREATE_SECRET empty).'},
            status=status.HTTP_501_NOT_IMPLEMENTED,
        )
    request_secret = (request.headers.get('X-Handoff-Secret') or request.headers.get('X-Handoff-Token') or '').strip()
    if not request_secret or not constant_time_compare(secret, request_secret):
        return Response({'error': 'Invalid handoff secret.'}, status=status.HTTP_403_FORBIDDEN)

    if not redis_client:
        return Response({'error': 'System error: Redis unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    phone = (request.data.get('phone_number') or request.data.get('phone') or '').strip()
    if not phone:
        return Response({'error': 'phone_number is required.'}, status=status.HTTP_400_BAD_REQUEST)

    from .sms_service import sms_service

    clean_phone = sms_service._clean_phone_number(phone, for_sms=False)
    create_if_missing = str(request.data.get('create_if_missing', 'true')).lower() in ('1', 'true', 'yes')

    user = _get_or_create_player_by_phone(clean_phone, create_if_missing, request.data)
    if user is None:
        return Response(
            {'error': 'No Gundu Ata user for this phone. Set create_if_missing or register first.'},
            status=status.HTTP_404_NOT_FOUND,
        )
    if not user.is_active:
        return Response({'error': 'User account is disabled.'}, status=status.HTTP_403_FORBIDDEN)
    if user.is_staff or user.is_superuser:
        return Response({'error': 'Staff users cannot use player handoff.'}, status=status.HTTP_403_FORBIDDEN)

    code = str(uuid.uuid4())
    ttl = int(getattr(settings, 'HANDOFF_CODE_TTL_SECONDS', 300))
    key = f'{HANDOFF_REDIS_PREFIX}{code}'
    try:
        redis_client.set(key, json.dumps({'user_id': user.id}), ex=ttl)
    except Exception as e:
        logger.exception('Handoff: could not store code: %s', e)
        return Response({'error': 'Could not create handoff code.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return Response(
        {
            'code': code,
            'expires_in': ttl,
            'user_id': user.id,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@csrf_exempt
def handoff_exchange(request):
    """
    Exchange a one-time code (from create) for JWT access/refresh. Single-use; code is deleted.
    """
    if not redis_client:
        return Response({'error': 'System error: Redis unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    code = (request.data.get('code') or request.data.get('handoff_code') or '').strip()
    if not code or len(code) < 8:
        return Response({'error': 'Valid code is required.'}, status=status.HTTP_400_BAD_REQUEST)

    key = f'{HANDOFF_REDIS_PREFIX}{code}'
    try:
        raw = redis_client.get(key)
    except Exception as e:
        logger.exception('Handoff exchange: redis get: %s', e)
        return Response({'error': 'Handoff service error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    if raw is None:
        return Response({'error': 'Invalid or expired handoff code.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        redis_client.delete(key)
    except Exception as e:
        logger.warning('Handoff exchange: delete key failed: %s', e)

    try:
        if isinstance(raw, bytes):
            raw = raw.decode('utf-8', errors='ignore')
        data = json.loads(raw)
        user_id = data.get('user_id')
    except Exception:
        return Response({'error': 'Handoff data corrupted.'}, status=status.HTTP_400_BAD_REQUEST)

    if not user_id:
        return Response({'error': 'Handoff data invalid.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User no longer exists.'}, status=status.HTTP_400_BAD_REQUEST)

    if not user.is_active or user.is_staff or user.is_superuser:
        return Response({'error': 'Login not allowed for this user.'}, status=status.HTTP_403_FORBIDDEN)

    refresh = RefreshToken.for_user(user)
    _set_single_session(user.id, refresh)

    user.last_login = timezone.now()
    user.save(update_fields=['last_login'])
    _sync_session_after_login(user)

    return Response(
        {
            'user': UserSerializer(user).data,
            'refresh': str(refresh),
            'access': str(refresh.access_token),
            'message': 'Handoff successful',
        },
        status=status.HTTP_200_OK,
    )
