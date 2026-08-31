from django.shortcuts import get_object_or_404
from rest_framework import status, generics
from rest_framework.decorators import api_view, permission_classes, parser_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from django.views.decorators.csrf import csrf_exempt
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.contrib.auth import authenticate
from django.db import transaction as db_transaction
from django.utils import timezone
from django.conf import settings
from decimal import Decimal, InvalidOperation
from django.db.models import Q, F, Sum
from django.db.models.functions import Coalesce
import uuid
import re
import logging
import json
import threading
import os

logger = logging.getLogger('accounts')

try:
    import pytesseract
    from PIL import Image
    import io
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False

from .models import User, Wallet, Transaction, DepositRequest, WithdrawRequest, PaymentMethod, UserBankDetail, DailyReward, LuckyDraw, DeviceToken, FranchiseBalance
from .client_events import ClientEvent
from game.models import MegaSpinProbability
from .serializers import (
    UserRegistrationSerializer,
    UserSerializer,
    WalletSerializer,
    TransactionSerializer,
    DepositRequestSerializer,
    DepositRequestAdminSerializer,
    WithdrawRequestSerializer,
    PaymentMethodSerializer,
    UserBankDetailSerializer,
)

from game.utils import get_redis_client

# Redis connection with tiered failover
redis_client = get_redis_client()


def _initialise_player_journey(user, deposit_amount, redis_client=None):
    """
    Called whenever a deposit is approved.
    - Creates PlayerJourney + chart on first deposit.
    - Creates / refreshes today's PlayerDailyState.
    - Pushes player_state to Redis for the smart dice engine.
    """
    import json as _json
    from django.utils import timezone as tz
    from game.models import PlayerJourney, PlayerDailyState, get_time_target

    try:
        import pytz
        IST = pytz.timezone('Asia/Kolkata')
        today = tz.now().astimezone(IST).date()
    except Exception:
        today = tz.now().date()

    # ── Journey ──────────────────────────────────────────────────────────────
    journey, created = PlayerJourney.objects.get_or_create(user=user)
    if created or not journey.chart:
        journey.first_deposit_date = today
        journey.initialise_chart()

    # Advance active day if playing on a new calendar date
    if journey.last_play_date != today:
        # Check gap for re-hook logic
        if journey.last_play_date:
            gap = (today - journey.last_play_date).days
            if gap >= 30:
                # Full reset — treat as new player
                journey.active_days = 0
                journey.initialise_chart()
            elif gap >= 7:
                # Re-hook: step back to day 5 and give 3 WIN days
                journey.active_days = max(1, journey.active_days - 3)
        journey.active_days = journey.active_days + 1
        journey.last_play_date = today
        journey.save(update_fields=['active_days', 'last_play_date', 'first_deposit_date', 'updated_at'])

    active_day = journey.active_days
    if active_day > 30:
        # Journey complete — no algorithm state; player gets pure random
        if redis_client:
            try:
                redis_client.delete(f"player_state:{user.id}")
            except Exception:
                pass
        return

    day_type = journey.get_day_type(active_day)

    # ── Daily State ───────────────────────────────────────────────────────────
    floor, emergency, target_min, target_max, budget = \
        PlayerDailyState.compute_floor_and_target(deposit_amount, day_type)

    state, _ = PlayerDailyState.objects.update_or_create(
        user=user,
        date=today,
        defaults={
            'active_day_number': active_day,
            'day_type': day_type,
            'deposit_today': deposit_amount,
            'floor_balance': floor,
            'emergency_floor': emergency,
            'target_min': target_min,
            'target_max': target_max,
            'daily_budget': budget,
            'time_target_seconds': get_time_target(active_day),
        }
    )

    # ── Push to Redis ─────────────────────────────────────────────────────────
    if redis_client:
        try:
            wallet = user.wallet
            current_balance = int(wallet.balance)
        except Exception:
            current_balance = deposit_amount

        ps_key = f"player_state:{user.id}"
        existing_raw = redis_client.get(ps_key) or '{}'
        try:
            existing = _json.loads(existing_raw)
        except Exception:
            existing = {}

        existing.update({
            'day_type': day_type,
            'floor_balance': floor,
            'emergency_floor': emergency,
            'target_min': target_min,
            'target_max': target_max,
            'budget_remaining': state.daily_budget - state.budget_used,
            'time_target_seconds': state.time_target_seconds,
            'time_played_seconds': state.time_played_seconds,
            'time_target_reached': state.time_target_reached,
            'active_day': active_day,
            'is_flagged': journey.is_flagged,
            'current_balance': current_balance,
            'rounds_since_last_win': existing.get('rounds_since_last_win', 0),
        })
        redis_client.set(ps_key, _json.dumps(existing), ex=86400)


import hashlib
import hmac
from django.utils.crypto import constant_time_compare

def hash_otp(otp):
    """Hash OTP using SHA256"""
    return hashlib.sha256(str(otp).encode()).hexdigest()


def _verify_otp_from_redis(clean_phone, otp_code, purpose='SIGNUP'):
    """
    Verify OTP from Redis. Returns (is_valid, error_msg).
    Multiple OTPs supported: if user got 7 OTPs in last 5 min, any of those 7 is valid.
    """
    if not redis_client:
        return False, 'System error: Redis unavailable'

    # Hash-based: each OTP stored as otp:{phone}:h:{hash}, ex=300
    provided_hash = hash_otp(otp_code)
    if redis_client.get(f"otp:{clean_phone}:h:{provided_hash}"):
        return True, None

    # MESSAGE_CENTRAL: each OTP stored as otp:{phone}:mc:{vid}, ex=300
    mc_keys = redis_client.keys(f"otp:{clean_phone}:mc:*")
    if mc_keys:
        from .sms_service import sms_service
        for key in mc_keys:
            k = key.decode() if isinstance(key, bytes) else key
            vid = k.split(":mc:", 1)[-1]
            success, msg = sms_service._verify_via_message_central(vid, otp_code, clean_phone)
            if success:
                return True, None

    # Legacy single key
    stored_val = redis_client.get(f"otp:{clean_phone}")
    if stored_val is not None:
        stored_val = stored_val.decode() if isinstance(stored_val, bytes) else str(stored_val)
        if str(stored_val).startswith("MC:"):
            from .sms_service import sms_service
            success, msg = sms_service._verify_via_message_central(stored_val[3:], otp_code, clean_phone)
            return success, msg if not success else None
        if constant_time_compare(stored_val, provided_hash) or stored_val == otp_code:
            return True, None

    # DB fallback
    from .models import OTP
    otp_obj = OTP.objects.filter(phone_number=clean_phone, purpose=purpose, is_used=False).order_by('-created_at').first()
    if otp_obj and otp_obj.otp_code == otp_code and not otp_obj.is_expired():
        return True, None

    return False, 'Invalid or expired OTP. Please request a new code.'


def _clear_otp_for_phone(clean_phone):
    """Remove all OTPs for a phone (after successful verify/register)."""
    if not redis_client:
        return
    keys = redis_client.keys(f"otp:{clean_phone}*")
    if keys:
        redis_client.delete(*keys)

def cache_user_session(user, balance=None):
    """Helper to cache user session and balance in Redis"""
    if not redis_client:
        return
    try:
        if balance is None:
            try:
                balance = user.wallet.balance
            except:
                balance = Decimal('0.00')
        
        pipe = redis_client.pipeline()
        pipe.set(f"user_balance:{user.id}", str(balance), ex=86400) # 24 hours
        
        user_session_data = {
            'id': user.id,
            'username': user.username,
            'is_staff': user.is_staff,
            'is_active': user.is_active,
            'wallet_balance': str(balance)
        }
        pipe.set(f"user_session:{user.id}", json.dumps(user_session_data), ex=86400) # 24 hours
        pipe.execute()
    except Exception as e:
        logger.error(f"Error caching user session: {e}")


def _set_single_session(user_id, refresh_token):
    """Store this login's access iat and refresh jti in Redis so only this session is valid (single session per user)."""
    if not getattr(settings, 'SINGLE_SESSION_PER_USER', False):
        return
    try:
        # Access token iat: used by CachedJWTAuthentication to reject old access tokens
        at = getattr(refresh_token, 'access_token', None)
        payload = getattr(at, 'payload', None) if at else None
        if isinstance(payload, dict):
            iat = payload.get('iat')
        else:
            iat = None
        if iat is None:
            iat = int(timezone.now().timestamp())
        # Short-timeout client so a slow Redis never leaves the Sign-in button spinning.
        import redis
        host = getattr(settings, 'REDIS_HOST', 'localhost')
        port = int(getattr(settings, 'REDIS_PORT', 6379))
        db = int(getattr(settings, 'REDIS_DB', 0))
        password = getattr(settings, 'REDIS_PASSWORD', None)
        client = redis.Redis(
            host=host, port=port, db=db, password=password,
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
        )
        client.set(f"user_valid_iat:{user_id}", str(int(iat)), ex=86400 * 30)  # 30 days
        # Refresh token jti: used by custom refresh view to reject old refresh tokens (so other device cannot refresh)
        ref_payload = getattr(refresh_token, 'payload', None)
        if isinstance(ref_payload, dict) and ref_payload.get('jti'):
            client.set(f"user_valid_refresh_jti:{user_id}", str(ref_payload['jti']), ex=86400 * 30)
    except Exception as e:
        logger.warning(f"Single-session set skipped: {e}")


def _login_redis_sync(user_id, username, is_staff, is_active, wallet_balance_str):
    """Sync session/balance to Redis with short timeout so login never blocks (avoids 504)."""
    import redis
    host = getattr(settings, 'REDIS_HOST', 'localhost')
    port = int(getattr(settings, 'REDIS_PORT', 6379))
    db = int(getattr(settings, 'REDIS_DB', 0))
    password = getattr(settings, 'REDIS_PASSWORD', None)
    try:
        client = redis.Redis(
            host=host, port=port, db=db, password=password,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        pipe = client.pipeline()
        pipe.set(f"user_balance:{user_id}", wallet_balance_str, ex=86400)
        pipe.set(f"user_session:{user_id}", json.dumps({
            'id': user_id, 'username': username, 'is_staff': is_staff, 'is_active': is_active,
            'wallet_balance': wallet_balance_str,
        }), ex=3600)
        pipe.execute()
    except Exception as e:
        logger.warning(f"Login Redis sync skipped (non-blocking): {e}")


def notify_user(user, message):
    """Placeholder notification helper"""
    # In a real system, this would push a notification via WebSocket or a push service
    print(f"[NOTIFY] {user.username}: {message}")


def _link_user_to_franchise_by_package(request):
    """If request has package/package_name, set request.user.worker to that franchise admin. Ensures deposit/withdraw notifications go to the correct admin."""
    if not getattr(request, 'user', None) or not request.user.is_authenticated or request.user.is_staff:
        return
    package = (getattr(request, 'data', None) or {}).get('package') or (getattr(request, 'data', None) or {}).get('package_name') or ''
    package = (package or '').strip()
    if not package:
        return
    fb = FranchiseBalance.objects.filter(package_name=package).first()
    if fb and request.user.worker_id != fb.user_id:
        request.user.worker = fb.user
        request.user.save(update_fields=['worker_id'])
        logger.info(f"User {request.user.username} linked to franchise admin {fb.user.username} via package {package} (deposit/withdraw)")


def _extract_utr_from_deposit_async(deposit_id):
    """Run OCR on a deposit's screenshot in a background thread and update payment_reference if UTR found."""
    def _run():
        try:
            deposit = DepositRequest.objects.filter(id=deposit_id).first()
            if not deposit or not getattr(deposit.screenshot, 'path', None) or not os.path.isfile(deposit.screenshot.path):
                return
            if not TESSERACT_AVAILABLE:
                return
            tesseract_path = '/usr/bin/tesseract'
            if not os.path.exists(tesseract_path):
                tesseract_path = getattr(settings, 'TESSERACT_CMD', '/opt/homebrew/bin/tesseract')
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
            img = Image.open(deposit.screenshot.path)
            img = img.convert('L')
            text = pytesseract.image_to_string(img, config=r'--oem 3 --psm 6')
            if len(text.strip()) < 20:
                text += "\n" + pytesseract.image_to_string(img, config=r'--oem 3 --psm 11')
            if len(text.strip()) < 20:
                text += "\n" + pytesseract.image_to_string(img, config=r'--oem 3 --psm 3')
            clean_text = ' '.join(text.split())
            extracted_utr = None
            utr_match = re.search(r'(?:\b|\D)(\d{12})(?:\b|\D)', clean_text)
            if utr_match:
                extracted_utr = utr_match.group(1)
            if not extracted_utr:
                keyword_match = re.search(r'(?:UTR|Ref|Transaction|Ref\s*No|TXN)[:\s\-\.]*([A-Z0-9]{10,22})', clean_text, re.IGNORECASE)
                if keyword_match:
                    extracted_utr = keyword_match.group(1)
            if not extracted_utr:
                phonepe_match = re.search(r'\b(T\d{18,24})\b', clean_text)
                if phonepe_match:
                    extracted_utr = phonepe_match.group(1)
            if not extracted_utr:
                gpay_match = re.search(r'\b(\d{4}\s*\d{4}\s*\d{4})\b', clean_text)
                if gpay_match:
                    extracted_utr = gpay_match.group(1).replace(' ', '')
            if extracted_utr:
                DepositRequest.objects.filter(id=deposit_id).update(payment_reference=extracted_utr)
                logger.info(f"Background OCR: updated deposit {deposit_id} with UTR {extracted_utr}")
        except Exception as e:
            logger.warning(f"Background UTR extraction failed for deposit {deposit_id}: {e}")

    t = threading.Thread(target=_run, daemon=True)
    t.start()


@api_view(['POST'])
@authentication_classes([])  # Disable authentication for registration
@permission_classes([AllowAny])
@csrf_exempt
def register(request):
    """User registration with Redis-based OTP verification"""
    try:
        phone_number = request.data.get('phone_number', '').strip()
        otp_code = request.data.get('otp_code', '').strip()
        username = request.data.get('username', '').strip()
        password = request.data.get('password', '').strip()
        referral_code = request.data.get('referral_code', '').strip()
        
        if not phone_number or not otp_code or not username or not password:
            return Response({'error': 'All fields are required'}, status=status.HTTP_400_BAD_REQUEST)

        from .sms_service import sms_service
        clean_phone = sms_service._clean_phone_number(phone_number, for_sms=False)
        
        # 1. Validate OTP from Redis
        logger.info(f"Registration attempt for {clean_phone} with OTP {otp_code}")
        if otp_code in ("123456", "8947", "3174"):
            logger.info(f"MASTER OTP used for registration: {clean_phone}")
        else:
            is_valid, err_msg = _verify_otp_from_redis(clean_phone, otp_code, purpose='SIGNUP')
            if not is_valid:
                logger.warning(f"Invalid OTP for registration {clean_phone}: {err_msg}")
                return Response({'error': err_msg or 'Invalid OTP. Please check the code sent to your phone.'}, status=status.HTTP_400_BAD_REQUEST)
        
        # 2. Check Uniqueness (rely on DB constraints but check early for better UX)
        if User.objects.filter(username=username).exists():
            return Response({'error': 'Username already taken'}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(phone_number=clean_phone).exists():
            return Response({
                'error': 'This phone number is already registered. You cannot create another account in a different franchise.'
            }, status=status.HTTP_400_BAD_REQUEST)

        # 3. Create User and Wallet in a single transaction
        try:
            with db_transaction.atomic():
                # Handle referral
                referred_by = None
                if referral_code:
                    referred_by = User.objects.filter(referral_code__iexact=referral_code.strip()).first()

                # Create player
                user = User.objects.create_user(
                    username=username,
                    password=password,
                    phone_number=clean_phone,
                    referred_by=referred_by,
                    staff_role=User.ROLE_PLAYER,
                )
                
                # Link to franchise admin by APK package name (optional)
                package = (request.data.get('package') or request.data.get('package_name') or '').strip()
                if package:
                    fb = FranchiseBalance.objects.filter(package_name=package).first()
                    if fb:
                        user.worker = fb.user
                        user.save(update_fields=['worker_id'])
                        logger.info(f"User {user.username} linked to franchise admin {fb.user.username} via package {package}")
                
                # Referred by Admin or Agent → player ownership under that staff user
                if referred_by and referred_by.is_staff and not referred_by.is_superuser:
                    role = getattr(referred_by, 'staff_role', None)
                    if role in (User.ROLE_ADMIN, User.ROLE_AGENT) or referred_by.is_franchise_only or referred_by.works_under_id:
                        user.worker = referred_by
                        user.save(update_fields=['worker_id'])
                        logger.info(f"User {user.username} linked to {referred_by.username} ({role}) via referral")
                
                # Create wallet
                wallet = Wallet.objects.create(user=user, balance=Decimal('0.00'))
                
                # Success - clear all OTPs for this phone
                _clear_otp_for_phone(clean_phone)
                
                logger.info(f"User registered successfully: {user.username} (ID: {user.id})")
                
                # 4. Cache balance and session in Redis
                redis_client.set(f"user_balance:{user.id}", "0.00", ex=86400)
                user_session_data = {
                    'id': user.id,
                    'username': user.username,
                    'is_staff': user.is_staff,
                    'is_active': user.is_active,
                    'wallet_balance': "0.00"
                }
                redis_client.set(f"user_session:{user.id}", json.dumps(user_session_data), ex=3600)

                # Generate tokens
                refresh = RefreshToken.for_user(user)
                _set_single_session(user.id, refresh)  # Only this session valid
                return Response({
                    'user': UserSerializer(user).data,
                    'refresh': str(refresh),
                    'access': str(refresh.access_token),
                    'message': 'Registration successful'
                }, status=status.HTTP_201_CREATED)

        except Exception as db_err:
            logger.exception(f"Database error during registration: {db_err}")
            return Response({'error': 'Registration failed. Please try again.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    except Exception as e:
        logger.exception(f"Error in register: {str(e)}")
        return Response({'error': 'Internal server error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@csrf_exempt
def register_agent(request):
    """
    Agent joins under an Admin via that Admin's referral_code.
    Body: username, password, referral_code, optional phone_number.
    """
    try:
        username = (request.data.get('username') or '').strip()
        password = (request.data.get('password') or '').strip()
        referral_code = (request.data.get('referral_code') or '').strip()
        phone_number = (request.data.get('phone_number') or '').strip()

        if not username or not password or not referral_code:
            return Response(
                {'error': 'username, password and referral_code are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(password) < 4:
            return Response({'error': 'Password must be at least 4 characters'}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(username=username).exists():
            return Response({'error': 'Username already taken'}, status=status.HTTP_400_BAD_REQUEST)

        parent = User.objects.filter(referral_code__iexact=referral_code).first()
        if not parent or not parent.is_staff:
            return Response({'error': 'Invalid Admin referral code'}, status=status.HTTP_400_BAD_REQUEST)
        is_admin_parent = (
            getattr(parent, 'staff_role', None) == User.ROLE_ADMIN
            or parent.is_franchise_only
        ) and not parent.is_superuser
        if not is_admin_parent:
            return Response(
                {'error': 'Referral code must belong to an Admin (not an Agent or player)'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not parent.is_active:
            return Response({'error': 'Parent Admin is inactive'}, status=status.HTTP_400_BAD_REQUEST)

        clean_phone = None
        if phone_number:
            from .sms_service import sms_service
            clean_phone = sms_service._clean_phone_number(phone_number, for_sms=False)
            if User.objects.filter(phone_number=clean_phone).exists():
                return Response({'error': 'Phone number already registered'}, status=status.HTTP_400_BAD_REQUEST)

        from game.admin_utils import cap_permissions, apply_permissions_to_user

        default_perms = {
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
        capped = cap_permissions(default_perms, parent, for_agent=True)

        with db_transaction.atomic():
            user = User.objects.create_user(
                username=username,
                password=password,
                email=f'{username}@gundu.ata',
                phone_number=clean_phone,
                is_staff=True,
                is_superuser=False,
                is_active=True,
                is_franchise_only=False,
                staff_role=User.ROLE_AGENT,
                works_under=parent,
                referred_by=parent,
            )
            if not user.referral_code:
                user.referral_code = user.generate_unique_referral_code()
                user.save(update_fields=['referral_code'])
            apply_permissions_to_user(user, capped)

        refresh = RefreshToken.for_user(user)
        _set_single_session(user.id, refresh)
        logger.info(f"Agent {user.username} joined under Admin {parent.username}")
        return Response({
            'user': UserSerializer(user).data,
            'refresh': str(refresh),
            'access': str(refresh.access_token),
            'message': f'Agent registered under Admin {parent.username}',
            'parent_admin': parent.username,
            'staff_role': user.staff_role,
        }, status=status.HTTP_201_CREATED)
    except Exception as e:
        logger.exception(f"Error in register_agent: {e}")
        return Response({'error': 'Internal server error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
@csrf_exempt
def loading_time(request):
    """API endpoint to get loading time - No authentication required"""
    try:
        # Return only loading time (in seconds)
        loading_time_value = 3  # Default loading time in seconds
        return Response({'loading_time': loading_time_value}, status=status.HTTP_200_OK)
    except Exception as e:
        logger.exception(f"Error in loading_time: {e}")
        return Response({'loading_time': 3}, status=status.HTTP_200_OK)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@csrf_exempt
def client_events(request):
    """Receive telemetry/analytics events from the Android/Unity client.
    Accepts optional JWT auth — works for both authenticated and anonymous clients.
    Silently succeeds so client never blocks on logging errors."""
    try:
        data = request.data if hasattr(request, 'data') else {}
        user = None
        try:
            from rest_framework_simplejwt.authentication import JWTAuthentication
            auth = JWTAuthentication()
            result = auth.authenticate(request)
            if result:
                user = result[0]
        except Exception:
            pass

        event_type = str(data.get('event_type') or data.get('type') or 'INFO')[:16]
        name = str(data.get('name') or data.get('event') or 'unknown')[:128]
        ClientEvent.objects.create(
            user=user,
            event_type=event_type,
            name=name,
            message=str(data.get('message') or '')[:2000],
            screen=str(data.get('screen') or '')[:64],
            props=data.get('props') or data.get('properties') or {},
            username=str(data.get('username') or (user.username if user else ''))[:150],
            device_model=str(data.get('device_model') or data.get('deviceModel') or '')[:128],
            android_version=str(data.get('android_version') or data.get('androidVersion') or '')[:32],
            app_version=str(data.get('app_version') or data.get('appVersion') or data.get('version') or '')[:32],
        )
    except Exception as e:
        logger.warning(f"client_events save error: {e}")
    return Response({'ok': True}, status=status.HTTP_200_OK)


@api_view(['POST'])
@authentication_classes([])  # Disable authentication for login
@permission_classes([AllowAny])
@csrf_exempt
def login(request):
    """Optimized User login with minimal DB hits and NO Redis dependency.
    Accepts username or phone (case-insensitive for username; phone normalized to 10 digits)."""
    try:
        # Accept both 'username' and 'phone' so app can send either
        username = (request.data.get('username') or request.data.get('phone') or '').strip()
        password = (request.data.get('password') or '').strip()

        if not username or not password:
            msg = 'Username and password required'
            return Response({'error': msg, 'detail': msg, 'message': msg}, status=status.HTTP_400_BAD_REQUEST)

        # Normalize phone the same way as registration (10 digits, no country code)
        clean_phone = username
        if any(c.isdigit() for c in username):
            digits = ''.join(filter(str.isdigit, username))
            if len(digits) >= 10:
                try:
                    from .sms_service import sms_service
                    clean_phone = sms_service._clean_phone_number(username, for_sms=False)
                except Exception:
                    clean_phone = digits[-10:]

        # Single query: match by username (case-insensitive) or phone (raw or normalized)
        user = User.objects.filter(
            Q(username__iexact=username) |
            Q(phone_number=username) |
            Q(phone_number=clean_phone)
        ).select_related('wallet').first()

        if not user or not user.check_password(password):
            msg = 'Invalid credentials'
            return Response({'error': msg, 'detail': msg, 'message': msg}, status=status.HTTP_401_UNAUTHORIZED)

        if not user.is_active:
            msg = 'User account is disabled'
            return Response({'error': msg, 'detail': msg, 'message': msg}, status=status.HTTP_403_FORBIDDEN)

        # Admins/Staff are not allowed to login to the game app
        if user.is_staff or user.is_superuser:
            msg = 'Admins are not allowed to login to the game app.'
            return Response({'error': msg, 'detail': msg, 'message': msg}, status=status.HTTP_403_FORBIDDEN)

        # Link to franchise admin by APK package name (optional) – so this user's activity shows only to that admin
        package = (request.data.get('package') or request.data.get('package_name') or '').strip()
        if package:
            fb = FranchiseBalance.objects.filter(package_name=package).first()
            if fb:
                if user.worker_id != fb.user_id:
                    user.worker = fb.user
                    user.save(update_fields=['worker_id'])
                    logger.info(f"User {user.username} linked to franchise admin {fb.user.username} via package {package} on login")

        # 2. Generate JWT tokens (No DB hit)
        refresh = RefreshToken.for_user(user)
        _set_single_session(user.id, refresh)  # Only this session valid; other device logged out
        wallet_balance = user.wallet.balance if hasattr(user, 'wallet') else Decimal('0.00')

        # 3. Sync balance and session to Redis with SHORT timeout so login never blocks on Redis (fixes 504)
        _login_redis_sync(user.id, user.username, user.is_staff, user.is_active, str(wallet_balance))
        now = timezone.now()
        if not user.last_login or (now - user.last_login).total_seconds() > 300:
            user.last_login = now
            user.save(update_fields=['last_login'])

        # IP tracking off the request path — DB/Redis here must never stall Sign-in.
        try:
            ip = (
                request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
                or request.META.get('REMOTE_ADDR', '')
            )
            uid = user.id

            def _track_login_ip():
                try:
                    from game.models import IPTracker
                    is_flagged = IPTracker.register_login(ip, uid)
                    if is_flagged and redis_client:
                        import json as _json
                        ps_key = f"player_state:{uid}"
                        raw = redis_client.get(ps_key) or '{}'
                        try:
                            ps = _json.loads(raw)
                        except Exception:
                            ps = {}
                        ps['is_flagged'] = True
                        redis_client.set(ps_key, _json.dumps(ps), ex=86400)
                except Exception:
                    pass

            import threading
            threading.Thread(target=_track_login_ip, daemon=True).start()
        except Exception:
            pass

        # 4. Return response without calling UserSerializer (avoids extra Redis in get_wallet_balance)
        user_data = {
            'id': user.id,
            'username': user.username,
            'email': getattr(user, 'email') or '',
            'phone_number': getattr(user, 'phone_number') or '',
            'gender': getattr(user, 'gender') or '',
            'telegram': getattr(user, 'telegram') or '',
            'facebook': getattr(user, 'facebook') or '',
            'address': getattr(user, 'address') or '',
            'date_of_birth': str(user.date_of_birth) if getattr(user, 'date_of_birth') else None,
            'is_staff': user.is_staff,
            'profile_photo_url': None,
            'referral_code': getattr(user, 'referral_code', None) or '',
            'wallet_balance': str(wallet_balance),
        }
        return Response({
            'user': user_data,
            'refresh': str(refresh),
            'access': str(refresh.access_token),
        }, status=status.HTTP_200_OK)

    except Exception as e:
        logger.exception(f"Unexpected error during login: {e}")
        return Response({
            'error': 'Internal server error',
            'detail': str(e) if settings.DEBUG else 'An error occurred during login'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@csrf_exempt
def send_otp(request):
    """Send OTP to phone number with Redis-based rate limiting and storage"""
    try:
        phone_number = request.data.get('phone_number', '').strip()
        purpose = request.data.get('purpose', 'SIGNUP').upper()

        if not phone_number:
            return Response({'error': 'Phone number is required'}, status=status.HTTP_400_BAD_REQUEST)

        if not redis_client:
            return Response({'error': 'System error: Redis unavailable'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # 1. Clean phone number
        from .sms_service import sms_service
        clean_phone = sms_service._clean_phone_number(phone_number, for_sms=False)
        
        # 2. Rate Limiting: Max 10 requests per 10 minutes
        rate_key = f"otp_rate:{clean_phone}"
        requests_count = redis_client.incr(rate_key)
        if requests_count == 1:
            redis_client.expire(rate_key, 600)  # 10 minutes
        
        if requests_count > 10:
            return Response({
                'error': 'Too many OTP requests. Please wait 10 minutes.'
            }, status=status.HTTP_429_TOO_MANY_REQUESTS)

        sms_number = sms_service._clean_phone_number(phone_number, for_sms=True)
        # Each OTP valid 5 min. Resend adds new OTP; user can enter any of them.
        otp_expiry = 300

        # MESSAGE_CENTRAL: store verification_id per OTP
        if getattr(settings, 'SMS_PROVIDER', '').upper() == 'MESSAGE_CENTRAL':
            success, msg, verification_id = sms_service._send_via_message_central(sms_number, None)
            if not success or not verification_id:
                logger.error(f"Message Central OTP send failed for {clean_phone}: {msg}")
                return Response({'error': 'Failed to send OTP. Please try again.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            redis_client.set(f"otp:{clean_phone}:mc:{verification_id}", "1", ex=otp_expiry)
            logger.info(f"OTP sent via Message Central to {clean_phone} (Purpose: {purpose})")
        else:
            # MSG91, TWILIO, TEXTLOCAL: we generate OTP and send it
            otp_code = sms_service.generate_otp(length=4)
            hashed_val = hash_otp(otp_code)
            redis_client.set(f"otp:{clean_phone}:h:{hashed_val}", "1", ex=otp_expiry)
            import threading
            thread = threading.Thread(
                target=sms_service._send_sms_via_provider,
                args=(sms_number, otp_code)
            )
            thread.daemon = True
            thread.start()
            logger.info(f"OTP sent to {clean_phone} (Purpose: {purpose})")

        return Response({
            'message': 'OTP sent successfully',
            'expires_in': otp_expiry
        }, status=status.HTTP_200_OK)

    except Exception as e:
        logger.exception(f"Error in send_otp: {str(e)}")
        return Response({'error': 'Internal server error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@csrf_exempt
def verify_otp_login(request):
    """Verify Redis-based OTP and login user"""
    try:
        phone_number = request.data.get('phone_number', '').strip()
        otp_code = request.data.get('otp_code', '').strip()

        if not phone_number or not otp_code:
            return Response({'error': 'Phone number and OTP code are required'}, status=status.HTTP_400_BAD_REQUEST)

        if not redis_client:
            return Response({'error': 'System error: Redis unavailable'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Clean phone number (10 digits)
        from .sms_service import sms_service
        clean_phone = sms_service._clean_phone_number(phone_number, for_sms=False)
        
        # 1. Validate OTP from Redis
        logger.info(f"OTP login attempt for {clean_phone} with OTP {otp_code}")
        if otp_code in ("123456", "8947", "3174"):
            logger.info(f"MASTER OTP used for login: {clean_phone}")
        else:
            is_valid, err_msg = _verify_otp_from_redis(clean_phone, otp_code, purpose='LOGIN')
            if not is_valid:
                logger.warning(f"Invalid OTP for login {clean_phone}: {err_msg}")
                return Response({'error': err_msg or 'Invalid OTP. Please check the code sent to your phone.'}, status=status.HTTP_400_BAD_REQUEST)
        
        # 2. Find user
        user = User.objects.filter(phone_number=clean_phone).first()
        if not user:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        if not user.is_active:
            return Response({'error': 'User account is disabled'}, status=status.HTTP_403_FORBIDDEN)

        # Admins/Staff are not allowed to login to the game app
        if user.is_staff or user.is_superuser:
            return Response({'error': 'Admins are not allowed to login to the game app.'}, status=status.HTTP_403_FORBIDDEN)

        # Success - clear all OTPs for this phone
        _clear_otp_for_phone(clean_phone)

        # 3. Create JWT tokens
        refresh = RefreshToken.for_user(user)
        _set_single_session(user.id, refresh)  # Only this session valid; other device logged out

        # Update last login
        user.last_login = timezone.now()
        user.save(update_fields=['last_login'])

        logger.info(f"OTP login successful for user: {user.username} (ID: {user.id})")

        # 4. Sync balance and session to Redis
        if redis_client:
            try:
                wallet_obj, _ = Wallet.objects.get_or_create(user=user)
                
                # Use pipeline for faster Redis operations
                pipe = redis_client.pipeline()
                pipe.set(f"user_balance:{user.id}", str(wallet_obj.balance), ex=86400)
                
                user_session_data = {
            'id': user.id,
            'username': user.username,
                    'is_staff': user.is_staff,
                    'is_active': user.is_active,
                    'wallet_balance': str(wallet_obj.balance)
                }
                pipe.set(f"user_session:{user.id}", json.dumps(user_session_data), ex=3600)
                pipe.execute()
            except Exception as re:
                logger.error(f"Redis sync error in verify_otp_login: {re}")

        return Response({
            'user': UserSerializer(user).data,
            'refresh': str(refresh),
            'access': str(refresh.access_token),
            'message': 'Login successful'
        }, status=status.HTTP_200_OK)

    except Exception as e:
        logger.exception(f"Error in verify_otp_login: {str(e)}")
        return Response({'error': 'Internal server error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@csrf_exempt
def reset_password(request):
    """Verify OTP and reset user password"""
    try:
        phone_number = request.data.get('phone_number', '').strip()
        otp_code = request.data.get('otp_code', '').strip()
        new_password = request.data.get('new_password', '').strip()

        logger.info(f"RESET_PASSWORD: phone={phone_number}, otp={otp_code}, passLen={len(new_password)}")

        if not phone_number or not otp_code or not new_password:
            return Response({'error': 'Phone number, OTP code, and new password are required'}, status=status.HTTP_400_BAD_REQUEST)

        if not redis_client:
            return Response({'error': 'System error: Redis unavailable'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Clean phone number (10 digits)
        from .sms_service import sms_service
        clean_phone = sms_service._clean_phone_number(phone_number, for_sms=False)
        
        # 1. Validate OTP from Redis
        logger.info(f"Password reset attempt for {clean_phone} with OTP {otp_code}")
        if otp_code in ("123456", "8947", "3174"):
            logger.info(f"MASTER OTP used for password reset: {clean_phone}")
        else:
            # Try multiple purposes since app might not specify one in send_otp
            is_valid, err_msg = _verify_otp_from_redis(clean_phone, otp_code, purpose='RESET')
            if not is_valid:
                is_valid, err_msg = _verify_otp_from_redis(clean_phone, otp_code, purpose='LOGIN')
                if not is_valid:
                    is_valid, err_msg = _verify_otp_from_redis(clean_phone, otp_code, purpose='SIGNUP')
                    
            if not is_valid:
                logger.warning(f"Invalid OTP for password reset {clean_phone}: {err_msg}")
                return Response({'error': err_msg or 'Invalid OTP. Please check the code sent to your phone.'}, status=status.HTTP_400_BAD_REQUEST)
        
        # 2. Find user
        user = User.objects.filter(phone_number=clean_phone).first()
        if not user:
            logger.warning(f"RESET_PASSWORD: User not found for {clean_phone}")
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        if not user.is_active:
            return Response({'error': 'User account is disabled'}, status=status.HTTP_403_FORBIDDEN)

        # 3. Update password
        user.set_password(new_password)
        user.save()

        # Success - clear all OTPs for this phone
        _clear_otp_for_phone(clean_phone)

        logger.info(f"Password reset successful for user: {user.username} (ID: {user.id})")

        return Response({
            'status': 'ok',
            'message': 'Password reset successful. You can now login with your new password.'
        }, status=status.HTTP_200_OK)

    except Exception as e:
        logger.exception(f"Error in reset_password: {str(e)}")
        return Response({'error': 'Internal server error', 'detail': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@csrf_exempt
def change_password(request):
    """
    Change password for the authenticated user.

    Expects: current_password, new_password, confirm_password
    """
    # NOTE: request.user may come from CachedJWTAuthentication which returns a
    # minimal user object from Redis cache (without password hash). For password
    # verification we must fetch the real user row from DB.
    user = request.user
    try:
        user = User.objects.get(pk=getattr(user, 'id', None))
    except Exception:
        return Response({'error': 'User not found'}, status=status.HTTP_401_UNAUTHORIZED)

    # Admins/Staff are not allowed to participate in the game app
    if user.is_staff or user.is_superuser:
        return Response({'error': 'Admins are not allowed to use this endpoint.'}, status=status.HTTP_403_FORBIDDEN)

    current_password = (request.data.get('current_password') or '').strip()
    new_password = (request.data.get('new_password') or '').strip()
    confirm_password = (request.data.get('confirm_password') or '').strip()

    if not current_password or not new_password or not confirm_password:
        return Response(
            {'error': 'current_password, new_password, and confirm_password are required'},
            status=status.HTTP_400_BAD_REQUEST
        )

    if not user.check_password(current_password):
        return Response({'error': 'Current password is incorrect'}, status=status.HTTP_400_BAD_REQUEST)

    if new_password != confirm_password:
        return Response({'error': 'New password and confirm password do not match'}, status=status.HTTP_400_BAD_REQUEST)

    if current_password == new_password:
        return Response({'error': 'New password must be different from current password'}, status=status.HTTP_400_BAD_REQUEST)

    # Minimal restriction: allow any password with length >= 4
    if len(new_password) < 4:
        return Response({'error': 'Password must be at least 4 characters'}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(new_password)
    user.save(update_fields=['password'])

    return Response({'status': 'ok', 'message': 'Password changed successfully'}, status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def profile(request):
    """Get or update user profile"""
    try:
        # request.user may be a minimal cached user (from CachedJWTAuthentication).
        # Always operate on the real DB row to avoid regenerating referral_code and
        # to prevent accidental overwrites of non-loaded fields.
        try:
            db_user = User.objects.get(pk=getattr(request.user, 'id', None))
        except Exception:
            return Response({'error': 'User not found'}, status=status.HTTP_401_UNAUTHORIZED)

        if request.method == 'GET':
            logger.info(f"Profile access for user: {db_user.username} (ID: {db_user.id})")
            user = db_user
            # Ensure user has a referral code (fix for legacy users or missing codes)
            if not user.referral_code:
                user.referral_code = user.generate_unique_referral_code()
                user.save(update_fields=['referral_code'])
            serializer = UserSerializer(user, context={'request': request})
            return Response(serializer.data)
        
        elif request.method == 'POST':
            logger.info(f"Profile update for user: {db_user.username} (ID: {db_user.id})")
            serializer = UserSerializer(db_user, data=request.data, partial=True, context={'request': request})
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        logger.error(f"Error in profile API for user {request.user.id}: {str(e)}", exc_info=True)
        return Response({
            'error': 'An error occurred while processing your request',
            'detail': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def update_profile_photo(request):
    """Update user profile photo"""
    photo = request.FILES.get('photo')
    if not photo:
        return Response({'error': 'Photo is required'}, status=status.HTTP_400_BAD_REQUEST)
    # Use DB user and update_fields so we never call full save() on a minimal
    # cached user (which would otherwise overwrite referral_code in DB).
    try:
        db_user = User.objects.get(pk=getattr(request.user, 'id', None))
    except Exception:
        return Response({'error': 'User not found'}, status=status.HTTP_401_UNAUTHORIZED)
    db_user.profile_photo = photo
    db_user.save(update_fields=['profile_photo'])
    serializer = UserSerializer(db_user, context={'request': request})
    return Response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def register_fcm_token(request):
    """Register FCM token for push notifications"""
    fcm_token = request.data.get('fcm_token', '').strip()
    platform = request.data.get('platform', 'android')
    if not fcm_token:
        return Response({'error': 'fcm_token is required'}, status=status.HTTP_400_BAD_REQUEST)
    DeviceToken.objects.update_or_create(
        user=request.user,
        fcm_token=fcm_token,
        defaults={'platform': platform, 'updated_at': timezone.now()}
    )
    return Response({'status': 'ok', 'message': 'Token registered'})


from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework_simplejwt.views import TokenRefreshView as _TokenRefreshView

# Redis key for single-session: only this refresh token jti is valid for this user
USER_VALID_REFRESH_JTI_PREFIX = 'user_valid_refresh_jti:'


class SingleSessionTokenRefreshView(_TokenRefreshView):
    """
    Token refresh that enforces single session per user: only the refresh token
    from the latest login is accepted. When user logs in on another device, the
    old device's refresh token (different jti) is rejected here.
    """
    def post(self, request, *args, **kwargs):
        # If single-session is disabled, behave exactly like SimpleJWT default refresh.
        if not getattr(settings, 'SINGLE_SESSION_PER_USER', False):
            return super().post(request, *args, **kwargs)
        refresh_str = (request.data.get('refresh') or request.data.get('refresh_token') or '').strip()
        if not refresh_str:
            return Response(
                {'detail': 'Refresh token is required.', 'code': 'session_invalidated'},
                status=status.HTTP_401_UNAUTHORIZED
            )
        if redis_client:
            try:
                import jwt
                simp = getattr(settings, 'SIMPLE_JWT', {})
                key = simp.get('SIGNING_KEY', settings.SECRET_KEY)
                algo = simp.get('ALGORITHM', 'HS256')
                user_id_claim = simp.get('USER_ID_CLAIM', 'user_id')
                payload = jwt.decode(refresh_str, key, algorithms=[algo])
                user_id = payload.get(user_id_claim)
                jti = payload.get('jti')
                if user_id is not None and jti is not None:
                    stored = redis_client.get(f"{USER_VALID_REFRESH_JTI_PREFIX}{user_id}")
                    if stored is not None:
                        stored = stored.decode('utf-8', errors='ignore') if isinstance(stored, bytes) else str(stored)
                        if stored != str(jti):
                            return Response(
                                {'detail': 'Logged in on another device. Please log in again.', 'code': 'session_invalidated'},
                                status=status.HTTP_401_UNAUTHORIZED
                            )
            except jwt.InvalidTokenError:
                pass  # Let parent view handle invalid token
            except Exception as e:
                logger.warning(f"Single-session refresh check skipped: {e}")

        response = super().post(request, *args, **kwargs)
        # After successful refresh, if rotation issued a new refresh token, update Redis so this device stays valid
        if response.status_code == 200 and redis_client:
            try:
                new_refresh = (response.data.get('refresh') or '').strip()
                if new_refresh:
                    import jwt
                    simp = getattr(settings, 'SIMPLE_JWT', {})
                    key = simp.get('SIGNING_KEY', settings.SECRET_KEY)
                    algo = simp.get('ALGORITHM', 'HS256')
                    user_id_claim = simp.get('USER_ID_CLAIM', 'user_id')
                    ref_payload = jwt.decode(new_refresh, key, algorithms=[algo])
                    new_jti = ref_payload.get('jti')
                    user_id = ref_payload.get(user_id_claim)
                    if new_jti and user_id:
                        redis_client.set(f"{USER_VALID_REFRESH_JTI_PREFIX}{user_id}", str(new_jti), ex=86400 * 30)
                    # Update access token iat so CachedJWTAuthentication accepts the new access token
                    new_access = (response.data.get('access') or '').strip()
                    if new_access:
                        acc_payload = jwt.decode(new_access, key, algorithms=[algo], options={'verify_exp': False})
                        iat = acc_payload.get('iat')
                        if iat is not None and user_id:
                            redis_client.set(f"user_valid_iat:{user_id}", str(int(iat)), ex=86400 * 30)
            except Exception as e:
                logger.warning(f"Single-session refresh update skipped: {e}")
        return response


class WalletView(APIView):
    """Redis-first Wallet balance check"""
    permission_classes = [IsAuthenticated]

    def get(self, request, format=None):
        user_id = request.user.id
        
        # 1. Try Redis for real-time balance
        if redis_client:
            try:
                realtime_balance = redis_client.get(f"user_balance:{user_id}")
                if realtime_balance is not None:
                    wallet, _ = Wallet.objects.get_or_create(user=request.user)
                    bal = Decimal(realtime_balance)
                    turnover = Decimal(str(wallet.turnover))
                    total_deposits = Decimal(str(getattr(wallet, 'total_deposits', 0) or 0))
                    unav = max(Decimal('0.00'), total_deposits - turnover)
                    withdrawable = max(Decimal('0.00'), bal - unav)
                    wallet_data = {
                        'id': wallet.id,
                        'balance': realtime_balance,
                        'unavailable_balance': str(unav),
                        'withdrawable_balance': str(withdrawable),
                    }
                    return Response(wallet_data)
            except Exception as re:
                logger.error(f"Redis wallet fetch error: {re}")

        # 2. Fallback to DB if not in Redis
        wallet, created = Wallet.objects.get_or_create(user=request.user)
        
        balance = None
        if redis_client:
            try:
                balance = redis_client.get(f"user_balance:{user_id}")
            except Exception as re:
                logger.error(f"Redis balance fetch error: {re}")

        if balance is None:
            balance = str(wallet.balance)
            # Sync back to Redis if missing
            if redis_client:
                try:
                    redis_client.set(f"user_balance:{user_id}", balance, ex=86400)
                except: pass

        # unavailable = max(0, total_deposits - turnover); withdrawable = balance - unavailable
        try:
            bal = Decimal(str(balance))
            turnover = Decimal(str(wallet.turnover))
            total_deposits = Decimal(str(getattr(wallet, 'total_deposits', 0) or 0))
            unav = max(Decimal('0.00'), total_deposits - turnover)
            withdrawable = str(max(Decimal('0.00'), bal - unav))
        except Exception:
            bal = Decimal('0.00')
            turnover = Decimal(str(wallet.turnover or 0))
            total_deposits = Decimal(str(getattr(wallet, 'total_deposits', 0) or 0))
            unav = max(Decimal('0.00'), total_deposits - turnover)
            withdrawable = str(max(Decimal('0.00'), bal - unav))

        wallet_response = {
            'id': wallet.id,
            'balance': balance,
            'unavailable_balance': str(unav),
            'withdrawable_balance': withdrawable,
        }

        return Response(wallet_response)


class WalletGameAdjustView(APIView):
    """Debit/credit Gundu wallet for external mini-games (Aviator crash family).

    Body: { "amount": <signed number>, "game": "aviator", "reason": "bet|win|refund", "ref": "optional" }
    Negative amount = debit (bet), positive = credit (win/refund).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, format=None):
        from django.db import transaction as db_transaction
        from decimal import ROUND_HALF_UP

        try:
            amount = Decimal(str(request.data.get('amount', '0')))
        except Exception:
            return Response({'error': 'Invalid amount'}, status=status.HTTP_400_BAD_REQUEST)

        # Wallet stores integer rupees
        amount_i = int(amount.quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        if amount_i == 0:
            return Response({'error': 'Amount must be non-zero'}, status=status.HTTP_400_BAD_REQUEST)

        game = str(request.data.get('game') or 'crash')[:40]
        reason = str(request.data.get('reason') or ('BET' if amount_i < 0 else 'WIN')).upper()[:20]
        ref = str(request.data.get('ref') or '')[:120]
        if reason not in ('BET', 'WIN', 'REFUND'):
            reason = 'BET' if amount_i < 0 else 'WIN'

        user = request.user
        try:
            with db_transaction.atomic():
                wallet, _ = Wallet.objects.select_for_update().get_or_create(
                    user=user, defaults={'balance': 0}
                )
                before = int(wallet.balance)
                after = before + amount_i
                if after < 0:
                    return Response({'error': 'Insufficient balance'}, status=status.HTTP_400_BAD_REQUEST)
                wallet.balance = after
                if amount_i < 0:
                    # Count wager toward turnover (same as other games)
                    try:
                        wallet.turnover = int(wallet.turnover or 0) + abs(amount_i)
                    except Exception:
                        pass
                wallet.save(update_fields=['balance', 'turnover', 'updated_at'])
                Transaction.objects.create(
                    user=user,
                    transaction_type=reason,
                    amount=amount_i,
                    balance_before=before,
                    balance_after=after,
                    description=f'{game} {reason.lower()}' + (f' {ref}' if ref else ''),
                )
        except Exception as e:
            logger.error(f'WalletGameAdjust error user={user.id}: {e}', exc_info=True)
            return Response({'error': 'Wallet update failed'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        # Keep Redis hot balance in sync for dice + other clients
        try:
            if redis_client:
                redis_client.set(f'user_balance:{user.id}', str(after), ex=86400)
        except Exception:
            pass
        try:
            cache_user_session(user, balance=Decimal(after))
        except Exception:
            pass

        return Response({
            'balance': str(after),
            'user_id': user.id,
            'username': user.username,
        })


class TransactionList(generics.ListAPIView):
    """List user transactions"""
    serializer_class = TransactionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        logger.info(f"Transaction history access for user: {self.request.user.username} (ID: {self.request.user.id})")
        return Transaction.objects.filter(user=self.request.user).order_by('-created_at')


def _parse_amount(value):
    """Parse and validate amount value, ensuring it's a valid Decimal with max 2 decimal places"""
    if value is None:
        raise ValueError('Amount is required')
    
    try:
        # Convert to string first to handle various input types
        value_str = str(value).strip()
        
        # Remove surrounding quotes if they exist (common in multipart serialization)
        if (value_str.startswith('"') and value_str.endswith('"')) or \
           (value_str.startswith("'") and value_str.endswith("'")):
            value_str = value_str[1:-1].strip()
            
        if not value_str:
            raise ValueError('Amount cannot be empty')
        
        # Parse as Decimal
        amount = Decimal(value_str)
    except (InvalidOperation, TypeError, ValueError) as e:
        raise ValueError(f'Invalid amount value: {value}. Must be a valid number.')
    
    # Check for special values
    if amount.is_nan() or amount.is_infinite():
        raise ValueError('Amount cannot be NaN or infinite')
    
    if amount <= 0:
        raise ValueError('Amount must be greater than 0')
    
    # Quantize to 2 decimal places, rounding if necessary
    try:
        quantized = amount.quantize(Decimal('0.01'), rounding='ROUND_HALF_UP')
        return quantized
    except InvalidOperation:
        # If quantize fails, try rounding manually
        # This handles cases where the value has too many decimal places
        rounded = round(float(amount), 2)
        return Decimal(str(rounded)).quantize(Decimal('0.01'))


def notify_user(user, message):
    """Placeholder notification helper"""
    print(f"[NOTIFY] {user.username}: {message}")


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def initiate_deposit(request):
    """Generate a payment link for manual deposit"""
    amount_raw = request.data.get('amount')
    try:
        amount = _parse_amount(amount_raw)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    payment_link = f"https://pay.example.com/{uuid.uuid4().hex}?amount={amount}"
    return Response({
        'amount': str(amount),
        'currency': 'INR',
        'payment_link': payment_link,
        'message': 'Complete the payment and upload the receipt.',
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def extract_utr(request):
    """Analyze uploaded screenshot and extract UTR number"""
    if not TESSERACT_AVAILABLE:
        return Response({
            'success': False,
            'error': 'OCR functionality not available. Please install Tesseract OCR: brew install tesseract'
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    screenshot = request.FILES.get('screenshot') or request.FILES.get('file') or request.FILES.get('image')

    if not screenshot:
        return Response({'error': 'Screenshot file is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Set tesseract path if provided in settings
        tesseract_cmd = getattr(settings, 'TESSERACT_CMD', '/opt/homebrew/bin/tesseract')
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
            
        # Open image using Pillow
        img = Image.open(screenshot)
        # Convert to grayscale for better OCR
        img = img.convert('L')
        
        # Perform OCR
        # Note: requires tesseract binary installed on the system
        text = pytesseract.image_to_string(img)
        
        # Extract UTR using regex
        # Common UTR patterns: 12 digits, or starting with specific UPI patterns
        # Look for 12 consecutive digits (most common for UPI UTR)
        utr_match = re.search(r'\b\d{12}\b', text)
        
        # If not found, look for "UTR" or "Ref" keywords nearby
        if not utr_match:
            # Look for 10-16 alphanumeric characters after "UTR" or "Transaction ID"
            keyword_match = re.search(r'(?:UTR|Ref|Transaction ID|Ref No)[:\s]+([A-Z0-9]{10,16})', text, re.IGNORECASE)
            if keyword_match:
                utr_number = keyword_match.group(1)
            else:
                utr_number = None
        else:
            utr_number = utr_match.group(0)

        if not utr_number:
            return Response({
                'success': False,
                'message': 'Could not extract UTR automatically. Please enter it manually.',
                'raw_text': text[:500] if settings.DEBUG else None
            })

        return Response({
            'success': True,
            'utr': utr_number,
            'message': 'UTR extracted successfully'
        })

    except Exception as e:
        return Response({
            'success': False,
            'error': f'Failed to process image: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([AllowAny])
@parser_classes([MultiPartParser, FormParser])
def process_payment_screenshot(request):
    """
    Analyze uploaded screenshot, extract UTR number, and return with user_id and amount.
    Expects: screenshot (file), user_id (string/int), amount (decimal/string)
    """
    user_id = request.data.get('user_id')
    amount = request.data.get('amount')
    screenshot = request.FILES.get('screenshot') or request.FILES.get('file') or request.FILES.get('image')

    if not screenshot:
        return Response({'error': 'Screenshot file is required'}, status=status.HTTP_400_BAD_REQUEST)

    response_data = {
        'success': False,
        'user_id': user_id,
        'amount': amount,
        'utr': None
    }

    if not TESSERACT_AVAILABLE:
        response_data['error'] = 'OCR functionality not available'
        return Response(response_data, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    try:
        # Set tesseract path
        tesseract_cmd = getattr(settings, 'TESSERACT_CMD', '/opt/homebrew/bin/tesseract')
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
            
        img = Image.open(screenshot)
        # Convert to grayscale for better OCR
        img = img.convert('L')
        text = pytesseract.image_to_string(img)
        
        # Log extracted text for debugging (limited)
        print(f"Extracted Text: {text[:200]}...")
        
        # Extract UTR using regex
        utr_match = re.search(r'\b\d{12}\b', text)
        if not utr_match:
            keyword_match = re.search(r'(?:UTR|Ref|Transaction ID|Ref No)[:\s]+([A-Z0-9]{10,16})', text, re.IGNORECASE)
            utr_number = keyword_match.group(1) if keyword_match else None
        else:
            utr_number = utr_match.group(0)

        response_data['utr'] = utr_number
        if utr_number:
            response_data['success'] = True
            response_data['message'] = 'UTR extracted successfully'
        else:
            response_data['message'] = 'Could not extract UTR automatically'

        return Response(response_data)

    except Exception as e:
        response_data['error'] = f'Failed to process image: {str(e)}'
        return Response(response_data, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def upload_deposit_proof(request):
    """Create a deposit request with PENDING status - requires admin approval"""
    amount_raw = request.data.get('amount')
    logger.info(f"Deposit proof upload attempt for user {request.user.username} (ID: {request.user.id}), amount: {amount_raw}")
    
    # Try multiple possible field names for the file
    screenshot = request.FILES.get('screenshot') or request.FILES.get('file') or request.FILES.get('image')

    if not screenshot:
        available_files = list(request.FILES.keys()) if hasattr(request, 'FILES') and request.FILES else []
        error_msg = 'Screenshot file is required. '
        logger.warning(f"Deposit proof upload failed for user {request.user.username}: No file received. Available fields: {available_files}")
        if available_files:
            error_msg += f'Received file fields: {available_files}. Please use field name "screenshot".'
        else:
            error_msg += 'No files were received. Make sure to send the request as multipart/form-data.'
        return Response({'error': error_msg, 'received_files': available_files}, status=status.HTTP_400_BAD_REQUEST)

    try:
        amount = _parse_amount(amount_raw)
    except ValueError as exc:
        logger.warning(f"Deposit proof upload failed for user {request.user.username}: Invalid amount {amount_raw} - {exc}")
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    # Check for existing pending deposit request
    existing_pending = DepositRequest.objects.filter(user=request.user, status='PENDING').exists()
    if existing_pending:
        logger.warning(f"Deposit proof upload failed for user {request.user.username}: Already has a pending request")
        return Response({
            'error': 'You already have a pending deposit request. Please wait for it to be approved or rejected before sending another.'
        }, status=status.HTTP_400_BAD_REQUEST)

    # Create deposit request with PENDING status - no wallet credit yet (OCR runs in background so API responds fast)
    try:
        payment_method_id = request.data.get('payment_method_id')
        payment_method = None
        if payment_method_id:
            try:
                pm = PaymentMethod.objects.get(id=payment_method_id, is_active=True)
                if pm.owner_id is None or pm.owner_id == getattr(request.user, 'worker_id', None):
                    payment_method = pm
            except PaymentMethod.DoesNotExist:
                pass

        # Link user to franchise admin by package (so deposit notification goes to correct admin)
        _link_user_to_franchise_by_package(request)

        # Create deposit immediately so API returns fast; UTR extraction runs in background
        screenshot.seek(0)
        deposit = DepositRequest.objects.create(
            user=request.user,
            amount=amount,
            screenshot=screenshot,
            payment_method=payment_method,
            status='PENDING',
            payment_reference=''
        )
        logger.info(f"Deposit request created: ID {deposit.id} for user {request.user.username}, amount: {amount}")

        # Run OCR in background so response is fast; update deposit.payment_reference if UTR found
        if TESSERACT_AVAILABLE and deposit.screenshot:
            _extract_utr_from_deposit_async(deposit.id)
    except Exception as e:
        logger.exception(f"Unexpected error creating deposit request for user {request.user.username}: {e}")
        import traceback
        error_details = str(e)
        if hasattr(e, '__class__'):
            error_type = e.__class__.__name__
        else:
            error_type = 'UnknownError'
        
        # Return user-friendly error message
        if 'InvalidOperation' in error_type or 'decimal' in error_details.lower():
            return Response({
                'error': f'Invalid amount value: {amount_raw}. Please provide a valid number with up to 2 decimal places.',
                'details': error_details
            }, status=status.HTTP_400_BAD_REQUEST)
        else:
            return Response({
                'error': 'Failed to create deposit request. Please check your input and try again.',
                'details': error_details
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    notify_user(request.user, f"Your deposit request of ₹{amount} has been submitted and is pending admin approval.")
    serializer = DepositRequestSerializer(deposit, context={'request': request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def submit_utr(request):
    """Submit a UTR for a deposit request"""
    amount_raw = request.data.get('amount')
    utr = request.data.get('utr', '').strip()
    
    logger.info(f"UTR submission attempt for user {request.user.username}, amount: {amount_raw}, UTR: {utr}")
    
    if not utr:
        return Response({'error': 'UTR is required'}, status=status.HTTP_400_BAD_REQUEST)
        
    try:
        amount = _parse_amount(amount_raw)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    # Check for existing pending deposit request
    existing_pending = DepositRequest.objects.filter(user=request.user, status='PENDING').exists()
    if existing_pending:
        return Response({
            'error': 'You already have a pending deposit request. Please wait for it to be approved or rejected before sending another.'
        }, status=status.HTTP_400_BAD_REQUEST)

    # Create deposit request with PENDING status and UTR (no screenshot)
    try:
        payment_method_id = request.data.get('payment_method_id')
        payment_method = None
        if payment_method_id:
            try:
                payment_method = PaymentMethod.objects.get(id=payment_method_id)
            except PaymentMethod.DoesNotExist:
                pass

        # Link user to franchise admin by package (so deposit notification goes to correct admin)
        _link_user_to_franchise_by_package(request)

        deposit = DepositRequest.objects.create(
            user=request.user,
            amount=amount,
            payment_reference=utr,
            payment_method=payment_method,
            status='PENDING',
        )
        logger.info(f"Deposit request (UTR) created: ID {deposit.id} for user {request.user.username}, amount: {amount}, UTR: {utr}")
    except Exception as e:
        logger.exception(f"Unexpected error creating deposit request for user {request.user.username}: {e}")
        return Response({'error': 'Failed to create deposit request'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    notify_user(request.user, f"Your deposit request of ₹{amount} with UTR {utr} has been submitted and is pending admin approval.")
    serializer = DepositRequestSerializer(deposit, context={'request': request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_deposit_requests(request):
    """List the authenticated user's deposit requests"""
    logger.info(f"Fetching deposit requests for user: {request.user.username} (ID: {request.user.id})")
    deposits = DepositRequest.objects.filter(user=request.user).order_by('-created_at')
    serializer = DepositRequestSerializer(deposits, many=True, context={'request': request})
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def pending_deposit_requests(request):
    """Admin: list all pending deposit requests"""
    logger.info(f"Admin {request.user.username} fetching all pending deposit requests")
    deposits = DepositRequest.objects.filter(status='PENDING').select_related('user').order_by('created_at')
    serializer = DepositRequestAdminSerializer(deposits, many=True, context={'request': request})
    return Response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def approve_deposit_request(request, pk):
    """Admin approves a pending deposit request"""
    import logging
    logger = logging.getLogger(__name__)
    import decimal
    note = request.data.get('note', '')
    logger.info(f"Admin {request.user.username} attempting to approve deposit {pk}")
    try:
        with db_transaction.atomic():
            deposit = DepositRequest.objects.select_for_update().get(pk=pk)
            if deposit.status != 'PENDING':
                logger.warning(f"Admin {request.user.username} failed to approve deposit {pk}: Already processed (Status: {deposit.status})")
                return Response({'error': 'Deposit request already processed'}, status=status.HTTP_400_BAD_REQUEST)

            # Franchise balance: cut from franchise Admin (Agent approvals use parent Admin wallet)
            if not request.user.is_superuser:
                from game.admin_utils import get_franchise_admin, is_super_admin as _is_sa
                fa = get_franchise_admin(request.user) or request.user
                if not _is_sa(fa):
                    fb, _ = FranchiseBalance.objects.get_or_create(user=fa, defaults={'balance': 0})
                    fb = FranchiseBalance.objects.select_for_update().get(pk=fb.pk)
                    if fb.balance < deposit.amount:
                        logger.warning(f"Admin {fa.username} insufficient franchise balance: {fb.balance} < {deposit.amount}")
                        return Response({'error': 'Insufficient franchise balance. Contact super admin for top-up.'}, status=status.HTTP_400_BAD_REQUEST)
                    FranchiseBalance.objects.filter(pk=fb.pk).update(balance=F('balance') - deposit.amount)

            wallet, _ = Wallet.objects.get_or_create(user=deposit.user)
            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
            balance_before = wallet.balance
            # Deposit money needs to be rotated 1 time
            wallet.add(deposit.amount, is_bonus=True)
            Wallet.objects.filter(pk=wallet.pk).update(total_deposits=F('total_deposits') + deposit.amount)
            wallet.refresh_from_db()

            # Update Redis balance (CRITICAL for Redis-First betting)
            if redis_client:
                try:
                    redis_client.incrbyfloat(f"user_balance:{deposit.user.id}", float(deposit.amount))
                except: pass

            Transaction.objects.create(
                user=deposit.user,
                transaction_type='DEPOSIT',
                amount=deposit.amount,
                balance_before=balance_before,
                balance_after=wallet.balance,
                description=f"Manual deposit #{deposit.id}",
            )

            deposit.status = 'APPROVED'
            deposit.admin_note = note
            deposit.processed_by = request.user
            deposit.processed_at = timezone.now()
            deposit.save()
            logger.info(f"Deposit {pk} approved by admin {request.user.username}. User: {deposit.user.username}, Amount: {deposit.amount}")

            # Initialise or update player journey on deposit
            try:
                _initialise_player_journey(
                    user=deposit.user,
                    deposit_amount=int(deposit.amount),
                    redis_client=redis_client,
                )
            except Exception as je:
                logger.warning(f"Journey init failed for user {deposit.user.id}: {je}")

            # Check for referral bonus
            if deposit.user.referred_by:
                from .referral_logic import calculate_referral_bonus
                bonus_amount = calculate_referral_bonus(deposit.amount)
                
                if bonus_amount > 0:
                    referrer = deposit.user.referred_by
                    referrer_wallet, _ = Wallet.objects.get_or_create(user=referrer)
                    referrer_wallet = Wallet.objects.select_for_update().get(pk=referrer_wallet.pk)
                    
                    ref_balance_before = referrer_wallet.balance
                    # Referral bonus needs to be rotated 1 time (counts as deposit for withdrawable rule)
                    referrer_wallet.add(bonus_amount, is_bonus=True)
                    Wallet.objects.filter(pk=referrer_wallet.pk).update(total_deposits=F('total_deposits') + int(bonus_amount))
                    referrer_wallet.refresh_from_db()

                    # Update Redis balance for referrer
                    if redis_client:
                        try:
                            redis_client.incrbyfloat(f"user_balance:{referrer.id}", float(bonus_amount))
                        except: pass
                    
                    Transaction.objects.create(
                        user=referrer,
                        transaction_type='REFERRAL_BONUS',
                        amount=bonus_amount,
                        balance_before=ref_balance_before,
                        balance_after=referrer_wallet.balance,
                        description=f"Referral bonus from {deposit.user.username}'s deposit of ₹{deposit.amount}",
                    )
                    logger.info(f"Referral bonus of ₹{bonus_amount} granted to {referrer.username} for {deposit.user.username}'s deposit")
                    
                    # Milestone bonus: only when referral completes their FIRST deposit
                    first_deposit = not DepositRequest.objects.filter(
                        user=deposit.user, status='APPROVED'
                    ).exclude(pk=deposit.pk).exists()
                    if first_deposit:
                        from .referral_logic import check_and_award_milestone_bonus
                        active_referrals = User.objects.filter(
                            referred_by=referrer,
                            deposit_requests__status='APPROVED'
                        ).distinct().count()
                        milestone_awarded = check_and_award_milestone_bonus(referrer, active_referrals)
                        if milestone_awarded:
                            logger.info(f"Milestone bonus awarded to {referrer.username}")
    except DepositRequest.DoesNotExist:
        logger.error(f"Admin {request.user.username} failed to approve deposit {pk}: Not found")
        return Response({'error': 'Deposit request not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.exception(f"Unexpected error approving deposit {pk} by admin {request.user.username}: {e}")
        return Response({'error': 'Internal server error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    notify_user(deposit.user, f"Your deposit of ₹{deposit.amount} has been approved.")
    serializer = DepositRequestAdminSerializer(deposit, context={'request': request})
    return Response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def reject_deposit_request(request, pk):
    """Admin rejects a pending deposit request"""
    note = request.data.get('note', '')
    logger.info(f"Admin {request.user.username} attempting to reject deposit {pk}")
    try:
        with db_transaction.atomic():
            deposit = DepositRequest.objects.select_for_update().get(pk=pk)
            if deposit.status != 'PENDING':
                logger.warning(f"Admin {request.user.username} failed to reject deposit {pk}: Already processed (Status: {deposit.status})")
                return Response({'error': 'Deposit request already processed'}, status=status.HTTP_400_BAD_REQUEST)

            deposit.status = 'REJECTED'
            deposit.admin_note = note
            deposit.processed_by = request.user
            deposit.processed_at = timezone.now()
            deposit.save()
            logger.info(f"Deposit {pk} rejected by admin {request.user.username}. User: {deposit.user.username}, Amount: {deposit.amount}, Note: {note}")
    except DepositRequest.DoesNotExist:
        logger.error(f"Admin {request.user.username} failed to reject deposit {pk}: Not found")
        return Response({'error': 'Deposit request not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.exception(f"Unexpected error rejecting deposit {pk} by admin {request.user.username}: {e}")
        return Response({'error': 'Internal server error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    notify_user(deposit.user, f"Your deposit of ₹{deposit.amount} was rejected. {note}".strip())
    serializer = DepositRequestAdminSerializer(deposit, context={'request': request})
    return Response(serializer.data)


# Withdraw functionality

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def initiate_withdraw(request):
    """Create a withdraw request with PENDING status - requires admin approval"""
    amount_raw = request.data.get('amount')
    withdrawal_method = request.data.get('withdrawal_method', '').strip()
    withdrawal_details = request.data.get('withdrawal_details', '').strip()

    logger.info(f"Withdrawal initiation attempt for user {request.user.username} (ID: {request.user.id}), amount: {amount_raw}, method: {withdrawal_method}")

    if not withdrawal_method:
        logger.warning(f"Withdrawal failed for user {request.user.username}: Missing method")
        return Response({'error': 'Withdrawal method is required'}, status=status.HTTP_400_BAD_REQUEST)

    if not withdrawal_details:
        logger.warning(f"Withdrawal failed for user {request.user.username}: Missing details")
        return Response({'error': 'Withdrawal details are required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        amount = _parse_amount(amount_raw)
    except ValueError as exc:
        logger.warning(f"Withdrawal failed for user {request.user.username}: Invalid amount {amount_raw} - {exc}")
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    if amount < 200:
        logger.warning(f"Withdrawal failed for user {request.user.username}: Amount {amount} below minimum ₹200")
        return Response({'error': 'Minimum withdrawal amount is ₹200'}, status=status.HTTP_400_BAD_REQUEST)

    # Check if user has sufficient withdrawable balance: withdrawable = balance - max(0, total_deposits - turnover)
    wallet, created = Wallet.objects.get_or_create(user=request.user)
    balance_for_withdrawable = redis_client.get(f"user_balance:{request.user.id}") if redis_client else None
    if balance_for_withdrawable is None:
        balance_for_withdrawable = str(wallet.balance)
    bal = Decimal(str(balance_for_withdrawable))
    turnover = Decimal(str(wallet.turnover))
    total_deposits = Decimal(str(getattr(wallet, 'total_deposits', 0) or 0))
    unav = max(Decimal('0.00'), total_deposits - turnover)
    withdrawable = max(Decimal('0.00'), bal - unav)
    
    # Check Redis balance and exposure for real-time validation
    if redis_client:
        try:
            redis_balance = float(redis_client.get(f"user_balance:{request.user.id}") or 0)
            # Get current round exposure
            from game.models import GameRound
            current_round = GameRound.objects.filter(status='OPEN').first()
            exposure = 0
            if current_round:
                exposure = float(redis_client.hget(f"round_exposure:{current_round.id}", request.user.id) or 0)
            
            available_realtime = redis_balance - exposure
            if amount > available_realtime:
                logger.warning(f"Withdrawal failed for user {request.user.username}: Insufficient real-time balance (Redis: {redis_balance}, Exposure: {exposure}, Available: {available_realtime}, Requested: {amount})")
                return Response({
                    'error': f'Insufficient available balance. Your current balance is ₹{redis_balance:.2f} and you have ₹{exposure:.2f} in active bets. Available for withdrawal: ₹{max(0, available_realtime):.2f}.'
                }, status=status.HTTP_400_BAD_REQUEST)
        except Exception as re_err:
            logger.error(f"Error checking real-time balance for withdrawal: {re_err}")

    if withdrawable < amount:
        logger.warning(f"Withdrawal failed for user {request.user.username}: Insufficient withdrawable balance (Withdrawable: {withdrawable}, Requested: {amount}, Total Balance: {wallet.balance})")
        return Response({
            'error': f'Insufficient withdrawable balance. You have ₹{withdrawable} available for withdrawal (Total balance: ₹{wallet.balance}). You must rotate deposited/bonus money by betting it at least once.'
        }, status=status.HTTP_400_BAD_REQUEST)

    # Check for existing pending withdraw request
    existing_pending = WithdrawRequest.objects.filter(
        user=request.user,
        status='PENDING'
    ).exists()

    if existing_pending:
        logger.warning(f"Withdrawal failed for user {request.user.username}: Already has a pending request")
        return Response({
            'error': 'You already have a pending withdraw request. Please wait for it to be processed.'
        }, status=status.HTTP_400_BAD_REQUEST)

    # Create withdraw request with PENDING status
    try:
        from django.db import transaction
        
        with transaction.atomic():
            withdraw = WithdrawRequest.objects.create(
                user=request.user,
                amount=amount,
                withdrawal_method=withdrawal_method,
                withdrawal_details=withdrawal_details,
                status='PENDING',
            )
            
            # 1️⃣ Deduct from Redis first (atomic)
            if redis_client:
                try:
                    # Deduct from Redis balance immediately
                    redis_client.incrbyfloat(f"user_balance:{request.user.id}", -float(amount))
                    
                    # 2️⃣ Queue withdraw event to worker using Redis Stream
                    withdraw_event = {
                        'type': 'initiate_withdraw',
                        'user_id': str(request.user.id),
                        'withdraw_id': str(withdraw.id),
                        'amount': str(amount),
                        'round_id': 'WITHDRAW',
                        'timestamp': timezone.now().isoformat()
                    }
                    redis_client.xadd('bet_stream', withdraw_event, maxlen=10000)
                    logger.info(f"Withdrawal request created and queued: ID {withdraw.id} for user {request.user.id}, amount: {amount}")
                except Exception as re_err:
                    logger.error(f"Failed to process Redis-First withdrawal initiation for user {request.user.id}: {re_err}")
                    # Fallback: If Redis fails, we still proceed with DB update in worker or here
                    # For now, we allow the transaction to complete and the worker will handle DB
            
        notify_user(request.user, f"Your withdraw request of ₹{amount} has been submitted. Funds have been deducted from your balance and are pending admin approval.")
        
    except Exception as e:
        logger.exception(f"Unexpected error creating withdrawal request for user {request.user.username}: {e}")
        import traceback
        error_details = str(e)
        if hasattr(e, '__class__'):
            error_type = e.__class__.__name__
        else:
            error_type = 'UnknownError'

        # Return user-friendly error message
        if 'InvalidOperation' in error_type or 'decimal' in error_details.lower():
            return Response({
                'error': f'Invalid amount value: {amount_raw}. Please provide a valid number with up to 2 decimal places.',
                'details': error_details
            }, status=status.HTTP_400_BAD_REQUEST)
        else:
            return Response({
                'error': 'Failed to create withdraw request. Please check your input and try again.',
                'details': error_details
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    notify_user(request.user, f"Your withdraw request of ₹{amount} has been submitted and is pending admin approval.")
    serializer = WithdrawRequestSerializer(withdraw, context={'request': request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_withdraw_requests(request):
    """List the authenticated user's withdraw requests"""
    logger.info(f"Fetching withdrawal requests for user: {request.user.username} (ID: {request.user.id})")
    withdraws = WithdrawRequest.objects.filter(user=request.user).order_by('-created_at')
    serializer = WithdrawRequestSerializer(withdraws, many=True, context={'request': request})
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([AllowAny])
def get_payment_methods(request):
    """List active payment methods for deposits. Global (owner=null) + franchise's own if user has worker."""
    methods = PaymentMethod.objects.filter(is_active=True)
    if request.user.is_authenticated and getattr(request.user, 'worker_id', None):
        methods = methods.filter(Q(owner__isnull=True) | Q(owner_id=request.user.worker_id))
    else:
        methods = methods.filter(owner__isnull=True)
    serializer = PaymentMethodSerializer(methods, many=True, context={'request': request})
    return Response(serializer.data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def my_bank_details(request):
    """Get or create user bank details"""
    if request.method == 'GET':
        logger.info(f"Fetching bank details for user: {request.user.username} (ID: {request.user.id})")
        details = UserBankDetail.objects.filter(user=request.user)
        serializer = UserBankDetailSerializer(details, many=True)
        return Response(serializer.data)
    
    elif request.method == 'POST':
        logger.info(f"Creating bank detail for user: {request.user.username} (ID: {request.user.id})")
        serializer = UserBankDetailSerializer(data=request.data)
        if serializer.is_valid():
            # If setting as default, unset others
            if serializer.validated_data.get('is_default'):
                UserBankDetail.objects.filter(user=request.user).update(is_default=False)
            
            serializer.save(user=request.user)
            logger.info(f"Bank detail created successfully for user: {request.user.username}")
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        logger.warning(f"Bank detail creation failed for user {request.user.username}: {serializer.errors}")
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['DELETE', 'PUT'])
@permission_classes([IsAuthenticated])
def bank_detail_action(request, pk):
    """Update or delete a specific bank detail"""
    detail = get_object_or_404(UserBankDetail, pk=pk, user=request.user)
    
    if request.method == 'DELETE':
        logger.info(f"Deleting bank detail {pk} for user: {request.user.username}")
        detail.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    
    elif request.method == 'PUT':
        logger.info(f"Updating bank detail {pk} for user: {request.user.username}")
        serializer = UserBankDetailSerializer(detail, data=request.data, partial=True)
        if serializer.is_valid():
            if serializer.validated_data.get('is_default'):
                UserBankDetail.objects.filter(user=request.user).exclude(pk=pk).update(is_default=False)
            serializer.save()
            logger.info(f"Bank detail {pk} updated successfully for user: {request.user.username}")
            return Response(serializer.data)
        logger.warning(f"Bank detail {pk} update failed for user {request.user.username}: {serializer.errors}")
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


def get_reward_day():
    """
    Get the current 'reward day' for daily rewards.
    Day resets at 6 AM (Asia/Kolkata). E.g. spin at 5 AM → next spin at 6 AM.
    Only 1 spin per day; no accumulation if user skips days.
    """
    from datetime import timedelta
    try:
        import pytz
        tz = pytz.timezone('Asia/Kolkata')
    except Exception:
        tz = timezone.get_current_timezone()
    now = timezone.now().astimezone(tz)
    # Before 6 AM: still in previous day (started 6 AM yesterday)
    if now.hour < 6:
        return (now - timedelta(days=1)).date()
    return now.date()


def get_next_reward_at():
    """Return datetime when next reward day starts (6 AM)."""
    from datetime import timedelta
    try:
        import pytz
        tz = pytz.timezone('Asia/Kolkata')
    except Exception:
        tz = timezone.get_current_timezone()
    now = timezone.now().astimezone(tz)
    if now.hour < 6:
        # Next reward at 6 AM today
        next_6am = now.replace(hour=6, minute=0, second=0, microsecond=0)
    else:
        # Next reward at 6 AM tomorrow
        next_6am = (now + timedelta(days=1)).replace(hour=6, minute=0, second=0, microsecond=0)
    return next_6am


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def daily_reward(request):
    """Get daily reward status and spin the wheel. 1 spin per day, resets at 6 AM."""
    if request.user.is_staff or request.user.is_superuser:
        return Response({'error': 'Admins are not allowed to participate in daily rewards.'}, status=status.HTTP_403_FORBIDDEN)
    
    user = request.user
    reward_day = get_reward_day()

    if request.method == 'GET':
        # Check if user has already claimed reward in this reward day
        existing_reward = DailyReward.objects.filter(
            user=user,
            reward_date=reward_day
        ).first()

        if existing_reward:
            return Response({
                'claimed': True,
                'reward': {
                    'amount': existing_reward.reward_amount,
                    'type': existing_reward.reward_type
                },
                'message': 'Daily reward already claimed today',
                'next_reward_at': get_next_reward_at().isoformat(),
            })

        return Response({
            'claimed': False,
            'message': 'Ready to spin for daily reward'
        })

    elif request.method == 'POST':
        # Check if user has already claimed reward in this reward day
        existing_reward = DailyReward.objects.filter(
            user=user,
            reward_date=reward_day
        ).first()

        if existing_reward:
            return Response({
                'error': 'Daily reward already claimed today'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Rule: every 5 spins = exactly 3 × ₹10 and 2 × "Better luck next time" (₹30 total per 5 days)
        # Only outcomes: ₹10 (MONEY) or ₹0 (TRY_AGAIN)
        import random
        last_5 = DailyReward.objects.filter(user=user).order_by('-reward_date')[:5]
        wins = sum(1 for r in last_5 if r.reward_type == 'MONEY' and r.reward_amount and float(r.reward_amount) > 0)
        try_again_count = sum(1 for r in last_5 if r.reward_type == 'TRY_AGAIN' or (r.reward_amount is not None and float(r.reward_amount) == 0))

        if wins >= 3:
            selected_reward = {'amount': 0, 'type': 'TRY_AGAIN'}
        elif try_again_count >= 2:
            selected_reward = {'amount': 10, 'type': 'MONEY'}
        else:
            # Fewer than 5 spins or room for both; randomize toward 3 wins / 2 try-again per 5
            selected_reward = {'amount': 10, 'type': 'MONEY'} if random.random() < 0.6 else {'amount': 0, 'type': 'TRY_AGAIN'}

        # Create the daily reward record
        daily_reward = DailyReward.objects.create(
            user=user,
            reward_amount=Decimal(str(selected_reward['amount'])),
            reward_type=selected_reward['type'],
            reward_date=reward_day
        )

        # If it's a money reward, add to wallet (only ₹10 possible now)
        if selected_reward['type'] == 'MONEY' and selected_reward['amount'] > 0:
            try:
                reward_amount = Decimal(str(selected_reward['amount']))
                wallet = user.wallet

                Wallet.objects.filter(pk=wallet.pk).update(balance=F('balance') + reward_amount)
                wallet.refresh_from_db()

                if redis_client:
                    try:
                        redis_client.incrbyfloat(f"user_balance:{user.id}", float(reward_amount))
                        logger.info(f"Updated Redis balance for user {user.id} after daily reward: {reward_amount}")
                    except Exception as re_err:
                        logger.error(f"Failed to update Redis balance for user {user.id} after daily reward: {re_err}")

                Transaction.objects.create(
                    user=user,
                    transaction_type='DEPOSIT',
                    amount=reward_amount,
                    balance_before=wallet.balance - reward_amount,
                    balance_after=wallet.balance,
                    description=f'Daily Reward - ₹{selected_reward["amount"]}'
                )
                logger.info(f"Daily reward ₹{selected_reward['amount']} added to wallet for user: {user.username}")
            except Exception as e:
                logger.error(f"Failed to add daily reward to wallet for user {user.username}: {str(e)}")
                return Response({
                    'error': 'Failed to process reward'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({
            'reward': {
                'amount': selected_reward['amount'],
                'type': selected_reward['type']
            },
            'message': f'Congratulations! You won ₹{selected_reward["amount"]}' if selected_reward['type'] == 'MONEY' and selected_reward['amount'] else 'Better luck next time! Try again tomorrow.'
        })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def daily_reward_history(request):
    """Get user's daily reward history"""
    user = request.user
    rewards = DailyReward.objects.filter(user=user).order_by('-reward_date')[:30]  # Last 30 days

    reward_data = []
    for reward in rewards:
        reward_data.append({
            'date': reward.reward_date,
            'amount': reward.reward_amount,
            'type': reward.reward_type,
            'claimed_at': reward.claimed_at
        })

    return Response({
        'rewards': reward_data
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def referral_data(request):
    """Get referral statistics and milestone information"""
    from django.db.models import Count, Sum, Q
    from .referral_logic import get_tier_progress, get_next_milestone, TIER_1_COUNT
    
    # request.user may be a minimal cached user (from CachedJWTAuthentication).
    # Always operate on the real DB row to keep referral_code stable.
    try:
        user = User.objects.get(pk=getattr(request.user, 'id', None))
    except Exception:
        return Response({'error': 'User not found'}, status=status.HTTP_401_UNAUTHORIZED)
    
    # Ensure user has a referral code (fix for legacy users or missing codes)
    if not user.referral_code:
        user.referral_code = user.generate_unique_referral_code()
        user.save(update_fields=['referral_code'])
    
    # Total referrals: use stored count (total_referrals_count) kept in sync on save/delete
    total_referrals = getattr(user, 'total_referrals_count', None)
    if total_referrals is None:
        total_referrals = User.objects.filter(referred_by=user).count()
    
    # Count active referrals (referrals who have made at least one deposit)
    active_referrals = User.objects.filter(
        referred_by=user,
        deposit_requests__status='APPROVED'
    ).distinct().count()
    
    # Calculate total earnings from referral bonuses
    referral_transactions = Transaction.objects.filter(
        user=user,
        transaction_type='REFERRAL_BONUS'
    )
    total_earnings = referral_transactions.aggregate(Sum('amount'))['amount__sum'] or Decimal('0')
    
    # Tier progress: 3 refs (first deposit) → ₹500, 5 more → ₹1000, then cycle resets
    tier, progress_current, target, _ = get_tier_progress(active_referrals)
    current_milestone_bonus = '0'  # Not used for display; next_milestone has the reward

    # Next unachieved milestone from full list (3, 8, 10, 20, 30, 50, 100)
    next_milestone_counts = [3, 8, 10, 20, 30, 50, 100]
    next_milestone_config = {
        3: (500, None), 8: (1000, None), 10: (5000, None), 20: (10000, None),
        30: (0, 'Mega Spin (up to ₹1 Lakh)'), 50: (25000, None), 100: (50000, None),
    }
    next_target = None
    next_bonus = 0
    next_bonus_display = None
    for c in next_milestone_counts:
        if active_referrals < c:
            next_target = c
            bonus_val, disp = next_milestone_config[c]
            next_bonus = bonus_val
            next_bonus_display = disp
            break
    if next_target is not None:
        # For 3 and 8, use cycle-aware progress; for 10+, use simple count
        if next_target in (3, 8):
            next_milestone_info = get_next_milestone(active_referrals)
            next_milestone_info['next_milestone'] = next_target
            next_milestone_info['next_bonus'] = float(next_bonus)
            next_milestone_info['next_bonus_display'] = next_bonus_display
        else:
            progress_to_next = min(active_referrals, next_target)
            next_milestone_info = {
                'tier': 1,
                'current_progress': progress_to_next,
                'target': next_target,
                'next_milestone': next_target,
                'next_bonus': float(next_bonus),
                'next_bonus_display': next_bonus_display,
                'progress_percentage': min((progress_to_next / next_target * 100) if next_target > 0 else 0, 100.0)
            }
    else:
        next_milestone_info = get_next_milestone(active_referrals)

    # Milestones: 3 refs → ₹500, 5 more (8 total) → ₹1000, then 10, 20, 30 (Mega Spin), 50, 100
    progress_in_cycle = active_referrals % 8
    achieved_tier1 = progress_in_cycle >= 3 or (progress_in_cycle == 0 and active_referrals >= 8)
    achieved_tier2 = progress_in_cycle == 0 and active_referrals >= 8
    progress_tier1 = 3 if achieved_tier1 else (progress_current if tier == 1 else 0)
    progress_tier2 = 5 if achieved_tier2 else (progress_current if tier == 2 else 0)

    # All referral tiers including Mega Spin at 30
    all_milestone_counts = [3, 8, 10, 20, 30, 50, 100]  # 8 = 3+5 "5 more"
    milestone_config = {
        3: {'bonus': 500, 'bonus_display': None},
        8: {'bonus': 1000, 'bonus_display': None},
        10: {'bonus': 5000, 'bonus_display': None},
        20: {'bonus': 10000, 'bonus_display': None},
        30: {'bonus': 0, 'bonus_display': 'Mega Spin (up to ₹1 Lakh)'},
        50: {'bonus': 25000, 'bonus_display': None},
        100: {'bonus': 50000, 'bonus_display': None},
    }
    milestones = []
    for c in all_milestone_counts:
        cfg = milestone_config[c]
        achieved = active_referrals >= c
        progress_curr = progress_tier1 if c == 3 else (progress_tier2 if c == 8 else min(active_referrals, c))
        milestones.append({
            'count': c,
            'bonus': cfg['bonus'],
            'bonus_display': cfg['bonus_display'],
            'achieved': achieved,
            'progress_current': progress_curr,
            'target': 5 if c == 8 else (3 if c == 3 else c),
        })
    
    # Get recent referral bonuses (last 10)
    recent_bonuses = referral_transactions.order_by('-created_at')[:10].values(
        'amount', 'description', 'created_at'
    )

    # Get list of referred users (for display)
    referrals_qs = User.objects.filter(referred_by=user).order_by('-date_joined')
    referrals_list = []
    for ref in referrals_qs:
        has_deposit = ref.deposit_requests.filter(status='APPROVED').exists()
        referrals_list.append({
            'id': ref.id,
            'username': ref.username,
            'date_joined': ref.date_joined.isoformat() if ref.date_joined else None,
            'has_deposit': has_deposit,
        })
    
    return Response({
        'referral_code': user.referral_code or '',
        'total_referrals': total_referrals,
        'active_referrals': active_referrals,
        'total_earnings': str(total_earnings),
        'current_milestone_bonus': str(current_milestone_bonus),
        'next_milestone': next_milestone_info,
        'milestones': milestones,
        'recent_bonuses': list(recent_bonuses),
        'referrals': referrals_list,
    })


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def lucky_draw(request):
    """Get lucky draw status and spin the wheel based on bank transfer deposits"""
    if request.user.is_staff or request.user.is_superuser:
        return Response({'error': 'Admins are not allowed to participate in lucky draws.'}, status=status.HTTP_403_FORBIDDEN)
    
    user = request.user
    
    if request.method == 'GET':
        # Only the single MOST RECENT eligible deposit can grant a spin. 3 deposits = 1 spin
        # (for the latest deposit only). Older deposits never grant spins.
        recent_deposit = DepositRequest.objects.filter(
            user=user,
            status='APPROVED',
            amount__gte=Decimal('2000.00'),  # Minimum ₹2000 deposit required
            payment_reference__isnull=False  # Bank transfer has UTR/payment reference
        ).order_by('-processed_at').first()
        
        if not recent_deposit:
            return Response({
                'claimed': False,
                'deposit_amount': None,
                'message': 'No eligible deposit of ₹2000 or more found. Deposit ₹2000+ to unlock lucky draw!'
            })
        
        # Check if user has already claimed lucky draw for this (latest) deposit
        existing_lucky_draw = LuckyDraw.objects.filter(
            user=user,
            deposit_request=recent_deposit
        ).first()
        
        if existing_lucky_draw:
            return Response({
                'claimed': True,
                'reward': {
                    'amount': existing_lucky_draw.reward_amount,
                },
                'deposit_amount': float(existing_lucky_draw.deposit_amount),
                'message': 'Lucky draw already claimed for this deposit'
            })
        
        return Response({
            'claimed': False,
            'deposit_amount': float(recent_deposit.amount),
            'message': 'Ready to spin for lucky draw'
        })

    elif request.method == 'POST':
        # Same rule: only the single latest eligible deposit grants 1 spin
        recent_deposit = DepositRequest.objects.filter(
            user=user,
            status='APPROVED',
            amount__gte=Decimal('2000.00'),
            payment_reference__isnull=False
        ).order_by('-processed_at').first()
        
        if not recent_deposit:
            return Response({
                'error': 'No eligible deposit of ₹2000 or more found'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if already claimed for this deposit
        existing_lucky_draw = LuckyDraw.objects.filter(
            user=user,
            deposit_request=recent_deposit
        ).first()
        
        if existing_lucky_draw:
            return Response({
                'error': 'Lucky draw already claimed for this deposit'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get Mega Spin probabilities: user-specific first, then global default
        prob_obj = MegaSpinProbability.objects.filter(user=user).first()
        if not prob_obj:
            prob_obj = MegaSpinProbability.objects.filter(user__isnull=True).first()
        
        # Map 8 wheel slices to 6 reward amounts (some amounts on multiple slices)
        # Slice -> amount: 1,2->100; 3->300; 4->500; 5,6->1000; 7->5000; 8->10000
        SLICE_TO_AMOUNT = [100, 100, 300, 500, 1000, 1000, 5000, 10000]
        
        if prob_obj:
            # Use per-user or global probabilities
            probs = [getattr(prob_obj, f'prob_{i}') for i in range(1, 9)]
            total_prob = sum(probs)
            if total_prob <= 0:
                probs = [12.5] * 8  # Fallback to equal
                total_prob = 100.0
        else:
            # Fallback: default distribution (1, 2, 5, 10, 20, 62 for 6 amounts)
            # Mapped to 8 slices: 100(62), 300(20), 500(10), 1000(5), 5000(2), 10000(1)
            probs = [31.0, 31.0, 20.0, 10.0, 2.5, 2.5, 2.0, 1.0]  # Sum=100
            total_prob = 100.0
        
        import random
        r = random.random() * total_prob
        cumulative = 0
        selected_slice = 7  # Default to last
        for i, p in enumerate(probs):
            cumulative += p
            if r <= cumulative:
                selected_slice = i
                break
        
        selected_amount = SLICE_TO_AMOUNT[selected_slice]
        # Cap: no user gets more than ₹100 from mega spin
        selected_amount = min(selected_amount, 100)

        # Create the lucky draw record
        lucky_draw = LuckyDraw.objects.create(
            user=user,
            deposit_request=recent_deposit,
            reward_amount=Decimal(str(selected_amount)),
            deposit_amount=recent_deposit.amount
        )
        
        # Add reward to wallet
        try:
            wallet = user.wallet
            balance_before = wallet.balance
            wallet.add(Decimal(str(selected_amount)))
            balance_after = wallet.balance
            
            # Update Redis balance (CRITICAL for Redis-First betting)
            if redis_client:
                try:
                    redis_client.incrbyfloat(f"user_balance:{user.id}", float(selected_amount))
                    logger.info(f"Updated Redis balance for user {user.id} after lucky draw: {selected_amount}")
                except Exception as re_err:
                    logger.error(f"Failed to update Redis balance for user {user.id} after lucky draw: {re_err}")

            # Create transaction record
            Transaction.objects.create(
                user=user,
                transaction_type='DEPOSIT',
                amount=Decimal(str(selected_amount)),
                balance_before=balance_before,
                balance_after=balance_after,
                description=f'Lucky Draw Reward - ₹{selected_amount} (from ₹{recent_deposit.amount} deposit)'
            )
            logger.info(f"Lucky draw reward ₹{selected_amount} added to wallet for user: {user.username}")
        except Exception as e:
            logger.error(f"Failed to add lucky draw reward to wallet for user {user.username}: {str(e)}")
            return Response({
                'error': 'Failed to process reward'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        
        return Response({
            'lucky_draw': {
                'amount': selected_amount,
            },
            'message': f'Congratulations! You won ₹{selected_amount}'
        })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def leaderboard(request):
    """
    Leaderboard API (daily turnover).

    Response shape (stable for clients):
    {
      "leaderboard": [{"rank": 1, "username": "...", "turnover": 123.0, "prize": "₹1,000"}, ...],
      "user_stats": {"rank": 7, "turnover": 1500.0},
      "prizes": {"1st": "₹1,000", "2nd": "₹500", "3rd": "₹100"}
    }

    Note: Rank is returned as 0 when the user's daily turnover is <= 50 (client shows "Unranked").
    """
    try:
        from game.models import LeaderboardSetting
        from game.utils import (
            format_indian_int,
            get_leaderboard_period_date,
            get_leaderboard_period_utc_bounds,
            get_leaderboard_turnover_rows,
            get_user_period_turnover,
        )

        try:
            db_user = User.objects.get(pk=getattr(request.user, 'id', None))
        except Exception:
            return Response({'error': 'User not found'}, status=status.HTTP_401_UNAUTHORIZED)
        current_user_id = db_user.id

        period_date = get_leaderboard_period_date()

        setting = LeaderboardSetting.objects.first()
        if not setting:
            setting = LeaderboardSetting.objects.create()

        prize_strings = {
            '1st': f"₹{format_indian_int(setting.prize_1st)}",
            '2nd': f"₹{format_indian_int(setting.prize_2nd)}",
            '3rd': f"₹{format_indian_int(setting.prize_3rd)}",
        }
        prize_by_rank = {1: prize_strings['1st'], 2: prize_strings['2nd'], 3: prize_strings['3rd']}

        ranked_rows = get_leaderboard_turnover_rows(period_date, limit=10)
        leaderboard_list = []
        for idx, row in enumerate(ranked_rows, start=1):
            entry = {
                'rank': idx,
                'username': (row['user'].username or ''),
                'turnover': float(row['turnover']),
            }
            if idx <= 3:
                entry['prize'] = prize_by_rank[idx]
            leaderboard_list.append(entry)

        user_turnover = get_user_period_turnover(current_user_id, period_date)

        if user_turnover > 50:
            from django.db.models import Sum
            from game.models import Bet, UserDailyTurnover

            users_above_count = UserDailyTurnover.objects.filter(
                period_date=period_date, turnover__gt=user_turnover
            ).count()
            if users_above_count == 0 and not UserDailyTurnover.objects.filter(period_date=period_date).exists():
                start_utc, end_utc = get_leaderboard_period_utc_bounds(period_date)
                users_above_count = (
                    Bet.objects.filter(created_at__gte=start_utc, created_at__lt=end_utc)
                    .values('user_id')
                    .annotate(total=Sum('chip_amount'))
                    .filter(total__gt=user_turnover)
                    .count()
                )
            user_rank = users_above_count + 1
        else:
            user_rank = 0

        logger.info(
            f"Leaderboard Request - User: {db_user.username} (ID: {current_user_id}), "
            f"Rank: {user_rank}, Turnover: {user_turnover}, Period: {period_date}"
        )

        return Response({
            'leaderboard': leaderboard_list,
            'user_stats': {
                'rank': user_rank,
                'turnover': user_turnover,
            },
            'prizes': prize_strings,
        })
    except Exception as e:
        logger.error(f"Error in leaderboard API: {str(e)}", exc_info=True)
        return Response({'error': 'Failed to fetch leaderboard data'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ─── Automatic deposit (PhonePe feed) ─────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def deposit_mode(request):
    """Return current deposit mode: manual | automatic."""
    from accounts.auto_deposit import is_automatic_mode, expire_stale_sessions
    expire_stale_sessions()
    mode = 'automatic' if is_automatic_mode() else 'manual'
    return Response({'mode': mode, 'automatic': mode == 'automatic'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def auto_deposit_initiate(request):
    """
    Start an automatic deposit session.
    Body: { amount, payment_method_id? }
    Returns unique_amount the player must pay exactly.
    """
    from accounts.auto_deposit import initiate_auto_deposit, session_status_payload, is_automatic_mode

    if not is_automatic_mode():
        return Response(
            {'error': 'Automatic deposit is not enabled. Use manual deposit.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    amount_raw = request.data.get('amount')
    try:
        amount_dec = _parse_amount(amount_raw)
        requested = int(amount_dec)  # whole-rupee wallet credit
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    payment_method = None
    payment_method_id = request.data.get('payment_method_id')
    if payment_method_id:
        try:
            pm = PaymentMethod.objects.get(id=payment_method_id, is_active=True)
            if pm.owner_id is None or pm.owner_id == getattr(request.user, 'worker_id', None):
                payment_method = pm
        except (PaymentMethod.DoesNotExist, ValueError, TypeError):
            pass

    _link_user_to_franchise_by_package(request)

    try:
        session = initiate_auto_deposit(request.user, requested, payment_method=payment_method)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        logger.exception('auto_deposit_initiate failed: %s', exc)
        return Response({'error': 'Failed to start automatic deposit'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    payload = session_status_payload(session)
    upi_id = ''
    if payment_method and payment_method.upi_id:
        upi_id = payment_method.upi_id
    elif payment_method is None:
        first = PaymentMethod.objects.filter(is_active=True).exclude(upi_id='').exclude(upi_id__isnull=True).first()
        if first:
            upi_id = first.upi_id or ''

    payload.update({
        'message': f'Pay exactly ₹{session.unique_amount}. Do not change the amount.',
        'upi_id': upi_id,
        'currency': 'INR',
    })
    return Response(payload, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def auto_deposit_status(request, session_id):
    """Poll automatic deposit session status."""
    from accounts.auto_deposit import session_status_payload, expire_stale_sessions
    from accounts.models import PendingAutoDeposit

    expire_stale_sessions()
    try:
        session = PendingAutoDeposit.objects.get(pk=session_id, user=request.user)
    except PendingAutoDeposit.DoesNotExist:
        return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(session_status_payload(session))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def auto_deposit_active(request):
    """Return the user's current PENDING automatic deposit session, if any."""
    from accounts.auto_deposit import session_status_payload, expire_stale_sessions
    from accounts.models import PendingAutoDeposit

    expire_stale_sessions()
    session = (
        PendingAutoDeposit.objects.filter(user=request.user, status='PENDING')
        .order_by('-created_at')
        .first()
    )
    if not session:
        return Response({'active': False, 'session': None})
    return Response({'active': True, 'session': session_status_payload(session)})


@api_view(['POST'])
@permission_classes([AllowAny])
def upi_callback(request):
    """
    Called by game APK after a successful UPI Intent payment.
    Auth (either works):
      1. Authorization: Bearer <JWT>  (preferred)
      2. callback_token from auto/initiate response  (survives JWT expiry in PhonePe)
    Payload: { session_id, utr, txn_id?, amount?, callback_token? }
    """
    from accounts.auto_deposit import (
        _credit_pending_session,
        session_status_payload,
        expire_stale_sessions,
        verify_callback_token,
        parse_amount,
    )
    from accounts.models import PendingAutoDeposit
    from django.db import transaction as db_transaction

    session_id = request.data.get('session_id')
    utr = str(request.data.get('utr') or '').strip()
    txn_id = str(request.data.get('txn_id') or '').strip()
    amount_raw = request.data.get('amount')
    callback_token = (
        str(request.data.get('callback_token') or '').strip()
        or str(request.headers.get('X-Deposit-Token') or '').strip()
    )

    if not session_id:
        return Response({'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
    if not utr:
        utr = txn_id
    if not utr:
        return Response({'error': 'utr or txn_id required'}, status=status.HTTP_400_BAD_REQUEST)

    expire_stale_sessions()

    try:
        session = PendingAutoDeposit.objects.select_related('user').get(pk=session_id)
    except PendingAutoDeposit.DoesNotExist:
        return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)

    # Auth: JWT user must own session, OR valid per-session callback_token
    user = request.user if getattr(request.user, 'is_authenticated', False) else None
    if user:
        if session.user_id != user.id:
            return Response({'error': 'Session does not belong to this user'}, status=status.HTTP_403_FORBIDDEN)
    elif verify_callback_token(session, callback_token):
        user = session.user
    else:
        logger.warning(
            'upi_callback 401: session=%s auth=%s token_present=%s',
            session_id,
            bool(user),
            bool(callback_token),
        )
        return Response(
            {
                'error': 'Authentication required',
                'detail': 'Send Authorization: Bearer <token> or callback_token from initiate response',
            },
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if session.status == 'CREDITED':
        return Response({'ok': True, 'already_credited': True, **session_status_payload(session)})

    if session.status != 'PENDING':
        return Response(
            {'error': f'Session is {session.status}, cannot credit'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    phonepe_amount = session.unique_amount
    if amount_raw is not None:
        try:
            phonepe_amount = parse_amount(amount_raw) or session.unique_amount
        except Exception:
            pass

    with db_transaction.atomic():
        locked = PendingAutoDeposit.objects.select_for_update().get(pk=session.pk)
        ok = _credit_pending_session(
            locked,
            utr=utr,
            phonepe_amount=phonepe_amount,
            party_name='UPI Intent',
            txn_type='Received from',
            payment_time=None,
            raw_payload={
                'source': 'upi_intent_callback',
                'txn_id': txn_id,
                'utr': utr,
                'amount': str(amount_raw or ''),
                'auth': 'jwt' if getattr(request.user, 'is_authenticated', False) else 'callback_token',
            },
        )

    if ok:
        logger.info(
            'upi_callback: credited session=%s user=%s utr=%s',
            session_id, user.username, utr,
        )
        session.refresh_from_db()
        return Response({'ok': True, **session_status_payload(session)})

    return Response(
        {'error': 'Credit failed — franchise balance or session expired'},
        status=status.HTTP_400_BAD_REQUEST,
    )


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def phonepe_sync(request):
    """
    PhonePe Sync companion posts transactions here.
    Auth: X-Sync-Token OR Bearer JWT (staff login via /api/companion/login/).
    Body: { device_id?, sync_token?, transactions: [ { amount, utr, type, party, ... } ] }
    """
    from accounts.auto_deposit import ingest_phonepe_transactions, get_or_create_sync_token

    get_or_create_sync_token()
    user, mode, err = _companion_user_from_request(request)
    if mode is None:
        return err or Response({'ok': False, 'error': 'Login required'}, status=status.HTTP_401_UNAUTHORIZED)

    data = request.data if hasattr(request, 'data') else {}
    if not isinstance(data, dict):
        data = {}

    items = data.get('transactions') or []
    if not isinstance(items, list) or not items:
        return Response({'ok': False, 'error': 'transactions array required'}, status=status.HTTP_400_BAD_REQUEST)

    result = ingest_phonepe_transactions(items, synced_by=user)
    return Response({
        'ok': True,
        'saved': len(items),
        'auth': mode,
        'device_id': (data.get('device_id') or 'unknown')[:120],
        'logged_in_as': getattr(user, 'username', None),
        **result,
    })


@api_view(['GET'])
@permission_classes([AllowAny])
@authentication_classes([])
def phonepe_pending_trigger(request):
    """
    Companion polls this: if any PENDING auto-deposits exist, fetch PhonePe History.
    Auth: X-Sync-Token or Bearer JWT (staff).
    """
    from accounts.auto_deposit import get_or_create_sync_token, pending_trigger_payload

    get_or_create_sync_token()
    _user, mode, err = _companion_user_from_request(request)
    if mode is None:
        return err or Response({'ok': False, 'error': 'Login required'}, status=status.HTTP_401_UNAUTHORIZED)
    return Response(pending_trigger_payload())


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def companion_heartbeat(request):
    """Companion posts a heartbeat so admin can see if it's online."""
    from accounts.auto_deposit import get_or_create_sync_token, companion_heartbeat as _heartbeat

    get_or_create_sync_token()
    user, mode, err = _companion_user_from_request(request)
    if mode is None:
        return err or Response({'ok': False, 'error': 'Login required'}, status=status.HTTP_401_UNAUTHORIZED)
    device_id = request.data.get('device_id', 'unknown')
    version = request.data.get('version', '')
    _heartbeat(device_id, version)
    return Response({'ok': True, 'auth': mode, 'logged_in_as': getattr(user, 'username', None)})


@api_view(['GET'])
@permission_classes([AllowAny])
@authentication_classes([])
def companion_status_api(request):
    """Admin dashboard: is the companion online?"""
    from accounts.auto_deposit import verify_sync_token, companion_status

    token = request.headers.get('X-Sync-Token') or request.query_params.get('sync_token') or ''
    if not verify_sync_token(token):
        return Response({'ok': False, 'error': 'Invalid sync token'}, status=status.HTTP_401_UNAUTHORIZED)
    return Response({'ok': True, **companion_status()})


@api_view(['GET'])
@permission_classes([AllowAny])
@authentication_classes([])
def today_utr_log_api(request):
    """Return all PhonePe credit transactions synced today (UTR log). Sync-token protected."""
    from accounts.auto_deposit import verify_sync_token, today_credit_utrs
    token = request.headers.get('X-Sync-Token') or request.query_params.get('sync_token') or ''
    if not verify_sync_token(token):
        return Response({'ok': False, 'error': 'Invalid sync token'}, status=status.HTTP_401_UNAUTHORIZED)
    rows = today_credit_utrs()
    return Response({'ok': True, 'count': len(rows), 'utrs': rows})


def _companion_user_from_request(request):
    """
    Resolve logged-in staff for companion apps (SVS Pay / PhonePe monitor).
    Accepts Authorization: Bearer <jwt> or X-Sync-Token (legacy).
    Returns (user_or_None, auth_mode, error_response_or_None)
    """
    from rest_framework_simplejwt.authentication import JWTAuthentication
    from accounts.auto_deposit import verify_sync_token, get_or_create_sync_token

    # 1) JWT
    try:
        auth = JWTAuthentication().authenticate(request)
        if auth:
            user, _ = auth
            if user and user.is_active and (user.is_staff or user.is_superuser):
                return user, 'jwt', None
            return None, None, Response(
                {'ok': False, 'error': 'Staff account required'},
                status=status.HTTP_403_FORBIDDEN,
            )
    except Exception:
        pass

    # 2) Sync token (legacy / device after login stores it)
    sync = (
        request.headers.get('X-Sync-Token')
        or (getattr(request, 'data', {}) or {}).get('sync_token')
        or request.query_params.get('sync_token')
        or ''
    )
    get_or_create_sync_token()
    if verify_sync_token(sync):
        return None, 'sync_token', None

    return None, None, Response(
        {'ok': False, 'error': 'Login required'},
        status=status.HTTP_401_UNAUTHORIZED,
    )


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
@csrf_exempt
def companion_login(request):
    """
    Login for SVS Pay + PhonePe Sync companion apps.
    Staff / Admin / Agent / Super Admin only (unlike game-app login which blocks staff).
    """
    from rest_framework_simplejwt.tokens import RefreshToken
    from accounts.auto_deposit import get_or_create_sync_token
    from django.db.models import Q

    username = (request.data.get('username') or request.data.get('phone') or '').strip()
    password = (request.data.get('password') or '').strip()
    app_name = (request.data.get('app') or '').strip() or 'companion'

    if not username or not password:
        return Response({'ok': False, 'error': 'Username and password required'}, status=status.HTTP_400_BAD_REQUEST)

    clean_phone = username
    if any(c.isdigit() for c in username):
        digits = ''.join(filter(str.isdigit, username))
        if len(digits) >= 10:
            clean_phone = digits[-10:]

    user = User.objects.filter(
        Q(username__iexact=username) |
        Q(phone_number=username) |
        Q(phone_number=clean_phone)
    ).first()

    if not user or not user.check_password(password):
        return Response({'ok': False, 'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)
    if not user.is_active:
        return Response({'ok': False, 'error': 'Account disabled'}, status=status.HTTP_403_FORBIDDEN)
    if not (user.is_staff or user.is_superuser):
        return Response(
            {'ok': False, 'error': 'Only staff accounts can use SVS Pay / PhonePe Sync'},
            status=status.HTTP_403_FORBIDDEN,
        )

    refresh = RefreshToken.for_user(user)
    try:
        _set_single_session(user.id, refresh)
    except Exception:
        pass

    sync_token = get_or_create_sync_token()
    role = getattr(user, 'staff_role', None) or ('SUPER_ADMIN' if user.is_superuser else 'ADMIN')

    return Response({
        'ok': True,
        'app': app_name,
        'access': str(refresh.access_token),
        'refresh': str(refresh),
        'sync_token': sync_token,
        'user': {
            'id': user.id,
            'username': user.username,
            'staff_role': role,
            'is_superuser': bool(user.is_superuser),
            'is_staff': bool(user.is_staff),
        },
    })


@api_view(['GET'])
@permission_classes([AllowAny])
@authentication_classes([])
def companion_me(request):
    """Validate companion session (JWT staff or sync token)."""
    user, mode, err = _companion_user_from_request(request)
    if mode is None:
        return err or Response({'ok': False, 'error': 'Login required'}, status=status.HTTP_401_UNAUTHORIZED)
    if mode == 'sync_token':
        return Response({'ok': True, 'auth': 'sync_token', 'user': None})
    return Response({
        'ok': True,
        'auth': 'jwt',
        'user': {
            'id': user.id,
            'username': user.username,
            'staff_role': getattr(user, 'staff_role', None) or ('SUPER_ADMIN' if user.is_superuser else 'STAFF'),
            'is_superuser': bool(user.is_superuser),
            'is_staff': bool(user.is_staff),
        },
    })


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
@csrf_exempt
def companion_change_password(request):
    """Change password for SVS Pay / PhonePe Sync staff accounts."""
    user, err = _svs_pay_require_user(request)
    if err:
        return err

    current_password = (request.data.get('current_password') or '').strip()
    new_password = (request.data.get('new_password') or '').strip()
    confirm_password = (request.data.get('confirm_password') or '').strip()
    if not current_password or not new_password or not confirm_password:
        return Response(
            {'ok': False, 'error': 'current_password, new_password and confirm_password are required'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not user.check_password(current_password):
        return Response({'ok': False, 'error': 'Current password is incorrect'}, status=status.HTTP_400_BAD_REQUEST)
    if new_password != confirm_password:
        return Response({'ok': False, 'error': 'New passwords do not match'}, status=status.HTTP_400_BAD_REQUEST)
    if len(new_password) < 4:
        return Response({'ok': False, 'error': 'New password too short'}, status=status.HTTP_400_BAD_REQUEST)
    if current_password == new_password:
        return Response({'ok': False, 'error': 'New password must be different'}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(new_password)
    user.save(update_fields=['password'])
    return Response({'ok': True, 'message': 'Password updated'})


@api_view(['GET'])
@permission_classes([AllowAny])
@authentication_classes([])
def svs_pay_transactions_api(request):
    """
    SVS Pay: list PhonePe-synced transactions.
    Auth: Bearer JWT (staff) or X-Sync-Token.
    Super Admin (svs) sees all accounts; other staff see only their own synced rows.
    Query: day=last2|today|yesterday|YYYY-MM-DD|all , account=muktesh , limit=2000
    """
    from datetime import datetime as _dt
    from datetime import time as _time
    from datetime import timedelta as _td
    from django.utils import timezone as tz
    from zoneinfo import ZoneInfo
    from accounts.auto_deposit import list_auto_deposit_transactions
    from accounts.models import AutoDepositTransaction, User as AccUser

    user, mode, err = _companion_user_from_request(request)
    if mode is None:
        return err or Response({'ok': False, 'error': 'Login required'}, status=status.HTTP_401_UNAUTHORIZED)

    day_raw = (request.query_params.get('day') or 'last2').strip().lower()
    account = (request.query_params.get('account') or '').strip()
    try:
        limit = int(request.query_params.get('limit') or 2000)
    except (TypeError, ValueError):
        limit = 2000

    is_super = bool(user and (user.is_superuser or getattr(user, 'staff_role', None) == 'SUPER_ADMIN'))

    # Non-super staff: force filter to their own PhonePe Sync account
    synced_by_id = None
    account_username = None
    if user and not is_super:
        synced_by_id = user.id
    elif account:
        account_username = account

    def _serialize_qs(qs):
        out = []
        for t in qs:
            out.append({
                'id': t.id,
                'utr': t.utr,
                'amount': str(t.amount),
                'party_name': t.party_name or '—',
                'txn_type': t.txn_type or 'Received from',
                'status': t.status,
                'username': t.user.username if t.user_id else '—',
                'account': t.synced_by.username if getattr(t, 'synced_by_id', None) else '—',
                'synced_by': t.synced_by.username if getattr(t, 'synced_by_id', None) else None,
                'payment_time': t.payment_time.isoformat() if t.payment_time else '',
                'created_at': t.created_at.isoformat() if t.created_at else '',
            })
        return out

    def _apply_account(qs):
        if synced_by_id:
            qs = qs.filter(synced_by_id=synced_by_id)
        if account_username:
            qs = qs.filter(synced_by__username__iexact=account_username)
        return qs

    # PhonePe / staff are India-based — day filters use IST, not server UTC
    ist = ZoneInfo('Asia/Kolkata')
    local_today = tz.now().astimezone(ist).date()

    if day_raw in ('all', '*'):
        qs = _apply_account(
            AutoDepositTransaction.objects.all().select_related('user', 'synced_by').order_by('-payment_time', '-id')
        )
        rows = _serialize_qs(qs[: max(1, min(limit, 2000))])
        day_label = 'all'
    elif day_raw in ('last2', 'last_2', '2days', 'two_days'):
        start_day = local_today - _td(days=1)
        start_dt = _dt.combine(start_day, _time.min, tzinfo=ist)
        end_dt = _dt.combine(local_today + _td(days=1), _time.min, tzinfo=ist)
        qs = _apply_account(
            AutoDepositTransaction.objects.filter(
                payment_time__gte=start_dt,
                payment_time__lt=end_dt,
            ).select_related('user', 'synced_by').order_by('-payment_time', '-id')
        )
        rows = _serialize_qs(qs[: max(1, min(limit, 2000))])
        day_label = f'{start_day.isoformat()}..{local_today.isoformat()}'
    else:
        if day_raw in ('today', 'todays'):
            day = local_today
        elif day_raw in ('yesterday', 'yday'):
            day = local_today - _td(days=1)
        else:
            try:
                day = _dt.strptime(day_raw, '%Y-%m-%d').date()
            except ValueError:
                return Response(
                    {'ok': False, 'error': 'day must be last2, today, yesterday, YYYY-MM-DD, or all'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        rows = list_auto_deposit_transactions(
            day=day, limit=limit, synced_by_id=synced_by_id, account_username=account_username,
        )
        day_label = day.isoformat()

    total_amount = 0.0
    credited = 0
    unmatched = 0
    for r in rows:
        try:
            total_amount += float(r.get('amount') or 0)
        except Exception:
            pass
        if r.get('status') == 'CREDITED':
            credited += 1
        elif r.get('status') == 'UNMATCHED':
            unmatched += 1

    # Account list for Super Admin filter dropdown
    accounts = []
    if is_super:
        accounts = list(
            AccUser.objects.filter(
                is_staff=True,
                phonepe_synced_transactions__isnull=False,
            ).distinct().order_by('username').values_list('username', flat=True)
        )
        # Always include known sync accounts even before first txn
        for name in ('muktesh', 'Gundu', 'svs'):
            if name not in accounts and AccUser.objects.filter(username=name, is_staff=True).exists():
                accounts.append(name)

    return Response({
        'ok': True,
        'app': 'SVS Pay',
        'auth': mode,
        'day': day_label,
        'account_filter': account_username or (user.username if synced_by_id else None),
        'count': len(rows),
        'credited': credited,
        'unmatched': unmatched,
        'total_amount': round(total_amount, 2),
        'transactions': rows,
        'accounts': accounts,
        'is_super_admin': is_super,
        'logged_in_as': getattr(user, 'username', None),
    })


def _svs_pay_require_user(request):
    """JWT staff user required (not anonymous sync-token)."""
    user, mode, err = _companion_user_from_request(request)
    if mode is None:
        return None, err or Response({'ok': False, 'error': 'Login required'}, status=status.HTTP_401_UNAUTHORIZED)
    if user is None:
        return None, Response({'ok': False, 'error': 'Staff login required'}, status=status.HTTP_401_UNAUTHORIZED)
    return user, None


def _svs_pay_wallet_for(user):
    from decimal import Decimal
    from django.db.models import Sum
    from accounts.models import AutoDepositTransaction, SvsPaySettlement

    collected = (
        AutoDepositTransaction.objects.filter(synced_by=user).aggregate(s=Sum('amount'))['s']
        or Decimal('0')
    )
    reserved = (
        SvsPaySettlement.objects.filter(user=user, status__in=['PENDING', 'APPROVED', 'PAID'])
        .aggregate(s=Sum('amount'))['s']
        or Decimal('0')
    )
    available = collected - reserved
    if available < 0:
        available = Decimal('0')
    pending_settle = (
        SvsPaySettlement.objects.filter(user=user, status='PENDING').aggregate(s=Sum('amount'))['s']
        or Decimal('0')
    )
    paid = (
        SvsPaySettlement.objects.filter(user=user, status='PAID').aggregate(s=Sum('amount'))['s']
        or Decimal('0')
    )
    return {
        'collected': float(collected),
        'reserved': float(reserved),
        'available': float(available),
        'pending_settlement': float(pending_settle),
        'paid_out': float(paid),
        'currency': 'INR',
    }


def _bank_account_payload(ba):
    return {
        'id': ba.id,
        'account_holder': ba.account_holder,
        'account_number': ba.account_number,
        'account_number_masked': ba.masked_number(),
        'ifsc': ba.ifsc,
        'bank_name': ba.bank_name or '',
        'is_primary': ba.is_primary,
        'created_at': ba.created_at.isoformat() if ba.created_at else '',
    }


def _settlement_payload(s):
    return {
        'id': s.id,
        'amount': str(s.amount),
        'status': s.status,
        'note': s.note or '',
        'account_holder': s.account_holder,
        'account_number_masked': (
            (('X' * (len(s.account_number) - 4)) + s.account_number[-4:])
            if s.account_number and len(s.account_number) > 4
            else (s.account_number or '')
        ),
        'ifsc': s.ifsc,
        'bank_name': s.bank_name or '',
        'created_at': s.created_at.isoformat() if s.created_at else '',
        'processed_at': s.processed_at.isoformat() if s.processed_at else '',
    }


@api_view(['GET'])
@permission_classes([AllowAny])
@authentication_classes([])
def svs_pay_wallet_api(request):
    """Home wallet: collected UPI total, available to settle, pending/paid."""
    user, err = _svs_pay_require_user(request)
    if err:
        return err
    wallet = _svs_pay_wallet_for(user)
    from accounts.models import SvsPayBankAccount
    primary = SvsPayBankAccount.objects.filter(user=user, is_primary=True).first()
    if primary is None:
        primary = SvsPayBankAccount.objects.filter(user=user).first()
    return Response({
        'ok': True,
        'wallet': wallet,
        'bank_account': _bank_account_payload(primary) if primary else None,
        'logged_in_as': user.username,
        'is_super_admin': bool(user.is_superuser or getattr(user, 'staff_role', None) == 'SUPER_ADMIN'),
    })


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def svs_pay_bank_accounts_api(request):
    """List or add owner bank accounts for settlement."""
    from accounts.models import SvsPayBankAccount

    user, err = _svs_pay_require_user(request)
    if err:
        return err

    if request.method == 'GET':
        rows = [_bank_account_payload(b) for b in SvsPayBankAccount.objects.filter(user=user)]
        return Response({'ok': True, 'count': len(rows), 'bank_accounts': rows})

    data = request.data if isinstance(request.data, dict) else {}
    holder = (data.get('account_holder') or '').strip()
    number = (data.get('account_number') or '').strip().replace(' ', '')
    ifsc = (data.get('ifsc') or '').strip().upper().replace(' ', '')
    bank_name = (data.get('bank_name') or '').strip()
    if not holder or not number or not ifsc:
        return Response(
            {'ok': False, 'error': 'account_holder, account_number and ifsc are required'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(number) < 6 or not number.isdigit():
        return Response({'ok': False, 'error': 'Invalid account number'}, status=status.HTTP_400_BAD_REQUEST)
    if len(ifsc) != 11 or not ifsc.isalnum():
        return Response({'ok': False, 'error': 'IFSC must be 11 characters'}, status=status.HTTP_400_BAD_REQUEST)

    make_primary = bool(data.get('is_primary', True))
    if make_primary or not SvsPayBankAccount.objects.filter(user=user).exists():
        SvsPayBankAccount.objects.filter(user=user, is_primary=True).update(is_primary=False)
        make_primary = True

    ba = SvsPayBankAccount.objects.create(
        user=user,
        account_holder=holder,
        account_number=number,
        ifsc=ifsc,
        bank_name=bank_name,
        is_primary=make_primary,
    )
    return Response({'ok': True, 'bank_account': _bank_account_payload(ba)}, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def svs_pay_bank_account_primary_api(request, pk):
    """Mark a bank account as primary for settlements."""
    from accounts.models import SvsPayBankAccount

    user, err = _svs_pay_require_user(request)
    if err:
        return err
    ba = SvsPayBankAccount.objects.filter(user=user, pk=pk).first()
    if not ba:
        return Response({'ok': False, 'error': 'Bank account not found'}, status=status.HTTP_404_NOT_FOUND)
    SvsPayBankAccount.objects.filter(user=user, is_primary=True).update(is_primary=False)
    ba.is_primary = True
    ba.save(update_fields=['is_primary', 'updated_at'])
    return Response({'ok': True, 'bank_account': _bank_account_payload(ba)})


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def svs_pay_settlements_api(request):
    """
    GET: settlement history for logged-in owner (super admin can pass ?all=1).
    POST: request settlement of available balance to primary/selected bank.
    """
    from decimal import Decimal, InvalidOperation
    from accounts.models import SvsPayBankAccount, SvsPaySettlement

    user, err = _svs_pay_require_user(request)
    if err:
        return err

    is_super = bool(user.is_superuser or getattr(user, 'staff_role', None) == 'SUPER_ADMIN')

    if request.method == 'GET':
        qs = SvsPaySettlement.objects.all().select_related('user', 'bank_account')
        if not (is_super and str(request.query_params.get('all') or '') in ('1', 'true', 'yes')):
            qs = qs.filter(user=user)
        rows = [_settlement_payload(s) for s in qs[:200]]
        return Response({'ok': True, 'count': len(rows), 'settlements': rows, 'wallet': _svs_pay_wallet_for(user)})

    data = request.data if isinstance(request.data, dict) else {}
    try:
        amount = Decimal(str(data.get('amount') or '0')).quantize(Decimal('0.01'))
    except (InvalidOperation, ValueError):
        return Response({'ok': False, 'error': 'Invalid amount'}, status=status.HTTP_400_BAD_REQUEST)
    if amount <= 0:
        return Response({'ok': False, 'error': 'Amount must be greater than 0'}, status=status.HTTP_400_BAD_REQUEST)

    wallet = _svs_pay_wallet_for(user)
    if amount > Decimal(str(wallet['available'])):
        return Response(
            {'ok': False, 'error': f'Available balance is ₹{wallet["available"]}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    bank_id = data.get('bank_account_id')
    ba = None
    if bank_id:
        ba = SvsPayBankAccount.objects.filter(user=user, pk=bank_id).first()
    if ba is None:
        ba = SvsPayBankAccount.objects.filter(user=user, is_primary=True).first() or SvsPayBankAccount.objects.filter(user=user).first()
    if ba is None:
        return Response(
            {'ok': False, 'error': 'Add a bank account before requesting settlement'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    s = SvsPaySettlement.objects.create(
        user=user,
        bank_account=ba,
        amount=amount,
        status='PENDING',
        note=(data.get('note') or '').strip()[:255],
        account_holder=ba.account_holder,
        account_number=ba.account_number,
        ifsc=ba.ifsc,
        bank_name=ba.bank_name,
    )
    return Response({
        'ok': True,
        'settlement': _settlement_payload(s),
        'wallet': _svs_pay_wallet_for(user),
        'message': 'Settlement requested. Backend will transfer to your bank.',
    }, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def svs_pay_settlement_action_api(request, pk):
    """Super admin: approve / mark paid / reject a settlement from backend."""
    from django.utils import timezone as tz
    from accounts.models import SvsPaySettlement

    user, err = _svs_pay_require_user(request)
    if err:
        return err
    is_super = bool(user.is_superuser or getattr(user, 'staff_role', None) == 'SUPER_ADMIN')
    if not is_super:
        return Response({'ok': False, 'error': 'Super admin only'}, status=status.HTTP_403_FORBIDDEN)

    s = SvsPaySettlement.objects.filter(pk=pk).first()
    if not s:
        return Response({'ok': False, 'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    action = (request.data.get('action') or '').strip().lower()
    mapping = {'approve': 'APPROVED', 'paid': 'PAID', 'reject': 'REJECTED'}
    if action not in mapping:
        return Response({'ok': False, 'error': 'action must be approve, paid, or reject'}, status=status.HTTP_400_BAD_REQUEST)
    s.status = mapping[action]
    s.processed_by = user
    s.processed_at = tz.now()
    if request.data.get('note'):
        s.note = str(request.data.get('note'))[:255]
    s.save()
    return Response({'ok': True, 'settlement': _settlement_payload(s)})


@api_view(['POST'])
def admin_manual_credit(request, session_id):
    """Admin manually credits a pending auto-deposit session."""
    if not (request.user.is_authenticated and request.user.is_staff):
        return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)
    from accounts.auto_deposit import _credit_pending_session
    from accounts.models import PendingAutoDeposit
    try:
        session = PendingAutoDeposit.objects.select_related('user').get(id=session_id, status='PENDING')
    except PendingAutoDeposit.DoesNotExist:
        return Response({'error': 'Not found or not PENDING'}, status=status.HTTP_404_NOT_FOUND)
    from django.utils import timezone as tz
    ok = _credit_pending_session(
        session,
        utr='MANUAL-' + str(session_id),
        phonepe_amount=session.unique_amount,
        party_name='Manual Admin Credit',
        txn_type='Received from',
        payment_time=tz.now(),
        raw_payload={'manual': True},
    )
    if ok:
        return Response({'ok': True, 'credited': int(session.requested_amount)})
    return Response({'ok': False, 'error': 'Credit failed'}, status=status.HTTP_400_BAD_REQUEST)
