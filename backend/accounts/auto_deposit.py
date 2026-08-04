"""Automatic deposit: unique pay amounts + PhonePe feed matching."""

from __future__ import annotations

import logging
import re
import secrets
from datetime import timedelta
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from typing import Any

from django.db import transaction as db_transaction
from django.db.models import F
from django.utils import timezone

from accounts.models import (
    AutoDepositTransaction,
    FranchiseBalance,
    PendingAutoDeposit,
    PaymentMethod,
    Transaction,
    User,
    Wallet,
)
from game.utils import get_game_setting, get_redis_client

logger = logging.getLogger('accounts.auto_deposit')

UNIQUE_AMOUNT_WINDOW = Decimal('10.00')  # pay amount in [requested-10, requested)
SESSION_TTL_HOURS = 24
CREDIT_LIKE_TYPES = {
    'received from',
    'money received',
    'received',
    'credited',
    'payment received',
}


def is_automatic_mode() -> bool:
    mode = str(get_game_setting('DEPOSIT_MODE', 'manual') or 'manual').strip().lower()
    return mode == 'automatic'


def get_or_create_sync_token() -> str:
    """Return AUTO_DEPOSIT_SYNC_TOKEN, creating one if missing."""
    from game.models import GameSettings

    existing = str(get_game_setting('AUTO_DEPOSIT_SYNC_TOKEN', '') or '').strip()
    if existing:
        return existing
    token = secrets.token_urlsafe(24)
    GameSettings.objects.update_or_create(
        key='AUTO_DEPOSIT_SYNC_TOKEN',
        defaults={
            'value': token,
            'description': 'Token for PhonePe Sync companion app (X-Sync-Token header)',
        },
    )
    try:
        from game.utils import clear_game_setting_cache
        clear_game_setting_cache(['AUTO_DEPOSIT_SYNC_TOKEN'])
    except Exception:
        pass
    return token


def rotate_sync_token() -> str:
    from game.models import GameSettings

    token = secrets.token_urlsafe(24)
    GameSettings.objects.update_or_create(
        key='AUTO_DEPOSIT_SYNC_TOKEN',
        defaults={
            'value': token,
            'description': 'Token for PhonePe Sync companion app (X-Sync-Token header)',
        },
    )
    try:
        from game.utils import clear_game_setting_cache
        clear_game_setting_cache(['AUTO_DEPOSIT_SYNC_TOKEN'])
    except Exception:
        pass
    return token


def verify_sync_token(token: str | None) -> bool:
    expected = str(get_game_setting('AUTO_DEPOSIT_SYNC_TOKEN', '') or '').strip()
    if not expected:
        expected = get_or_create_sync_token()
    return bool(token) and token.strip() == expected


def parse_amount(amount_text: Any) -> Decimal | None:
    """Parse PhonePe amount text like '+ ₹650' / '₹100.50' / 100.5 to Decimal."""
    if amount_text is None or amount_text == '':
        return None
    if isinstance(amount_text, (int, float, Decimal)):
        try:
            return Decimal(str(amount_text)).quantize(Decimal('0.01'))
        except (InvalidOperation, ValueError):
            return None
    m = re.search(r'([\d,]+(?:\.\d+)?)', str(amount_text).replace(',', ''))
    if not m:
        return None
    try:
        return Decimal(m.group(1)).quantize(Decimal('0.01'))
    except (InvalidOperation, ValueError):
        return None


def expire_stale_sessions() -> int:
    now = timezone.now()
    updated = PendingAutoDeposit.objects.filter(
        status='PENDING',
        expires_at__lte=now,
    ).update(status='EXPIRED')
    return int(updated or 0)


def _locked_unique_amounts() -> set[Decimal]:
    expire_stale_sessions()
    vals = PendingAutoDeposit.objects.filter(status='PENDING').values_list('unique_amount', flat=True)
    out: set[Decimal] = set()
    for v in vals:
        try:
            out.add(Decimal(str(v)).quantize(Decimal('0.01')))
        except (InvalidOperation, ValueError):
            continue
    return out


def allocate_unique_amount(requested: int) -> Decimal:
    """
    Pick unused pay amount in [requested-10, requested) with 2 decimals.
    Excludes exact `requested` so unique_amount always differs from requested.
    """
    locked = _locked_unique_amounts()
    hi = Decimal(requested)
    lo = hi - UNIQUE_AMOUNT_WINDOW
    if lo < Decimal('1.00'):
        lo = Decimal('1.00')

    # Prefer random-ish candidates, then scan downward by ₹0.01
    step = Decimal('0.01')
    span_paise = int(((hi - lo) / step).to_integral_value(rounding=ROUND_DOWN))
    if span_paise <= 0:
        raise ValueError('Cannot allocate unique amount for this deposit size')

    # Try up to 200 random picks, then linear scan
    for _ in range(min(200, span_paise)):
        offset = secrets.randbelow(span_paise) + 1  # 1..span → exclude hi
        candidate = (hi - (step * offset)).quantize(Decimal('0.01'))
        if candidate < lo:
            continue
        if candidate == hi:
            continue
        if candidate not in locked:
            return candidate

    cur = (hi - step).quantize(Decimal('0.01'))
    while cur >= lo:
        if cur not in locked and cur != hi:
            return cur
        cur = (cur - step).quantize(Decimal('0.01'))

    raise ValueError(
        'No unique pay amounts left in this range. Try a different amount or wait for pending deposits to finish.'
    )


def initiate_auto_deposit(
    user: User,
    requested_amount: int,
    payment_method: PaymentMethod | None = None,
) -> PendingAutoDeposit:
    if not is_automatic_mode():
        raise ValueError('Automatic deposit mode is not enabled')
    if requested_amount < 1:
        raise ValueError('Deposit amount must be at least ₹1')

    expire_stale_sessions()

    with db_transaction.atomic():
        existing = (
            PendingAutoDeposit.objects.select_for_update()
            .filter(user=user, status='PENDING')
            .first()
        )
        if existing:
            if existing.expires_at <= timezone.now():
                existing.status = 'EXPIRED'
                existing.save(update_fields=['status', 'updated_at'])
            else:
                # Reuse existing pending session if same requested amount
                if int(existing.requested_amount) == int(requested_amount):
                    if payment_method and existing.payment_method_id != payment_method.id:
                        existing.payment_method = payment_method
                        existing.save(update_fields=['payment_method', 'updated_at'])
                    return existing
                raise ValueError(
                    'You already have a pending automatic deposit. '
                    f'Pay exactly ₹{existing.unique_amount} or wait until it expires.'
                )

        unique = allocate_unique_amount(int(requested_amount))
        session = PendingAutoDeposit.objects.create(
            user=user,
            requested_amount=int(requested_amount),
            unique_amount=unique,
            payment_method=payment_method,
            status='PENDING',
            expires_at=timezone.now() + timedelta(hours=SESSION_TTL_HOURS),
        )

    # Outside the atomic block — check if a matching UTR already exists in today's log
    _match_existing_utrs(session)
    return session


def _match_existing_utrs(session: 'PendingAutoDeposit') -> bool:
    """
    Immediately after creating a session, scan today's already-synced UNMATCHED credit
    transactions to see if the player already paid. If found, credit instantly.
    """
    try:
        today = timezone.now().date()
        candidates = AutoDepositTransaction.objects.filter(
            status='UNMATCHED',
            amount=session.unique_amount,
            payment_time__date=today,
        ).order_by('-payment_time')

        for txn in candidates:
            with db_transaction.atomic():
                locked = PendingAutoDeposit.objects.select_for_update().filter(
                    id=session.id, status='PENDING'
                ).first()
                if not locked:
                    return False
                ok = _credit_pending_session(
                    locked,
                    utr=txn.utr,
                    phonepe_amount=txn.amount,
                    party_name=txn.party_name or '',
                    txn_type=txn.txn_type or 'Received from',
                    payment_time=txn.payment_time,
                    raw_payload=getattr(txn, 'raw_payload', {}),
                )
                if ok:
                    logger.info('instant match: session %s ← UTR %s ₹%s', session.id, txn.utr, txn.amount)
                    return True
    except Exception as exc:
        logger.warning('_match_existing_utrs failed: %s', exc)
    return False


def _is_credit_like(txn_type: str, amount_text: str) -> bool:
    t = (txn_type or '').strip().lower()
    if t in CREDIT_LIKE_TYPES or t.startswith('received'):
        return True
    # PhonePe often shows credit as "+ ₹100"
    if '+' in str(amount_text or ''):
        return True
    # If type empty but has amount, allow match (companion may omit type)
    if not t:
        return True
    # Explicit debit types — skip
    if t.startswith('paid') or t.startswith('transfer to') or 'debited' in t:
        return False
    return True


def _deduct_franchise_for_player(user: User, amount_int: int) -> tuple[bool, str | None]:
    """Deduct from player's franchise Admin wallet. Super / unscoped players skip."""
    from game.admin_utils import get_franchise_admin, is_super_admin

    worker = getattr(user, 'worker', None)
    if not worker:
        return True, None
    fa = get_franchise_admin(worker) or worker
    if is_super_admin(fa):
        return True, None
    fb, _ = FranchiseBalance.objects.get_or_create(user=fa, defaults={'balance': 0})
    fb = FranchiseBalance.objects.select_for_update().get(pk=fb.pk)
    if fb.balance < amount_int:
        return False, (
            f'Insufficient franchise balance for {fa.username}: '
            f'₹{fb.balance} < ₹{amount_int}'
        )
    FranchiseBalance.objects.filter(pk=fb.pk).update(balance=F('balance') - amount_int)
    return True, None


def _credit_pending_session(
    session: PendingAutoDeposit,
    *,
    utr: str,
    phonepe_amount: Decimal,
    party_name: str,
    txn_type: str,
    payment_time,
    raw_payload: dict,
) -> bool:
    """Credit wallet for a locked PENDING session. Caller must be in atomic + select_for_update."""
    if session.status != 'PENDING':
        return False
    if session.expires_at <= timezone.now():
        session.status = 'EXPIRED'
        session.save(update_fields=['status', 'updated_at'])
        return False

    credit_amount = int(session.requested_amount)
    ok, err = _deduct_franchise_for_player(session.user, credit_amount)
    if not ok:
        logger.warning(
            'Auto-deposit credit deferred for session %s: %s',
            session.id,
            err,
        )
        # Keep PENDING so a later sync can retry after franchise top-up
        return False

    wallet, _ = Wallet.objects.get_or_create(user=session.user)
    wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
    balance_before = wallet.balance

    Wallet.objects.filter(pk=wallet.pk).update(
        balance=F('balance') + credit_amount,
        total_deposits=F('total_deposits') + credit_amount,
    )
    wallet.refresh_from_db()

    redis_client = get_redis_client()
    if redis_client:
        try:
            redis_client.incrbyfloat(f'user_balance:{session.user.id}', float(credit_amount))
        except Exception:
            pass

    Transaction.objects.create(
        user=session.user,
        transaction_type='DEPOSIT',
        amount=credit_amount,
        balance_before=balance_before,
        balance_after=wallet.balance,
        description=f'Automatic deposit #{session.id} UTR {utr}',
    )

    session.status = 'CREDITED'
    session.utr = utr
    session.credited_at = timezone.now()
    session.save(update_fields=['status', 'utr', 'credited_at', 'updated_at'])

    AutoDepositTransaction.objects.update_or_create(
        utr=utr,
        defaults={
            'amount': phonepe_amount,
            'party_name': (party_name or '')[:255],
            'txn_type': (txn_type or 'Received from')[:64],
            'user': session.user,
            'status': 'CREDITED',
            'payment_time': payment_time or timezone.now(),
            'raw_payload': raw_payload or {},
        },
    )

    # Referral + journey (best-effort)
    try:
        from accounts.views import _initialise_player_journey
        _initialise_player_journey(session.user, credit_amount, redis_client=redis_client)
    except Exception as je:
        logger.warning('Journey init failed for auto deposit user %s: %s', session.user_id, je)

    try:
        referrer = session.user.referred_by
        if referrer:
            from accounts.referral_logic import calculate_referral_bonus, check_and_award_milestone_bonus

            bonus_amount = calculate_referral_bonus(credit_amount)
            if bonus_amount and bonus_amount > 0:
                ref_wallet, _ = Wallet.objects.get_or_create(user=referrer)
                ref_wallet = Wallet.objects.select_for_update().get(pk=ref_wallet.pk)
                ref_before = ref_wallet.balance
                if hasattr(ref_wallet, 'add'):
                    ref_wallet.add(bonus_amount, is_bonus=True)
                else:
                    Wallet.objects.filter(pk=ref_wallet.pk).update(balance=F('balance') + int(bonus_amount))
                Wallet.objects.filter(pk=ref_wallet.pk).update(
                    total_deposits=F('total_deposits') + int(bonus_amount)
                )
                ref_wallet.refresh_from_db()
                if redis_client:
                    try:
                        redis_client.incrbyfloat(f'user_balance:{referrer.id}', float(bonus_amount))
                    except Exception:
                        pass
                Transaction.objects.create(
                    user=referrer,
                    transaction_type='REFERRAL_BONUS',
                    amount=int(bonus_amount),
                    balance_before=ref_before,
                    balance_after=ref_wallet.balance,
                    description=f"Referral bonus from {session.user.username}'s auto deposit of ₹{credit_amount}",
                )
                check_and_award_milestone_bonus(referrer)
    except Exception as re_err:
        logger.warning('Referral processing failed for auto deposit %s: %s', session.id, re_err)

    logger.info(
        'Auto-deposit credited session=%s user=%s amount=%s utr=%s',
        session.id,
        session.user.username,
        credit_amount,
        utr,
    )
    return True


def ingest_phonepe_transactions(items: list[dict]) -> dict:
    """
    Process PhonePe companion sync payload.
    Matches PENDING sessions by unique_amount; credits wallet; records unmatched UTRs.
    """
    expire_stale_sessions()
    credited = 0
    unmatched = 0
    skipped = 0
    errors: list[str] = []

    for raw in items or []:
        if not isinstance(raw, dict):
            skipped += 1
            continue

        utr = str(raw.get('utr') or '').strip()
        if not utr:
            utr = str(raw.get('phonepe_txn_id') or raw.get('txn_id') or '').strip()
        amount = parse_amount(raw.get('deposit_amount') if raw.get('deposit_amount') is not None else raw.get('amount'))
        txn_type = str(raw.get('type') or raw.get('txn_type') or '')
        party = str(raw.get('party') or raw.get('party_name') or '')
        amount_text = str(raw.get('amount') or '')

        if not utr or amount is None:
            skipped += 1
            errors.append(f'skip(no_utr_or_amount): type={txn_type!r} amount={amount_text!r}')
            continue

        if not _is_credit_like(txn_type, amount_text):
            skipped += 1
            continue  # expected for Paid-to / debit rows

        payment_time = timezone.now()
        # Prefer already-credited UTR — idempotent
        existing = AutoDepositTransaction.objects.filter(utr=utr).first()
        if existing and existing.status == 'CREDITED':
            skipped += 1
            continue

        try:
            with db_transaction.atomic():
                session = (
                    PendingAutoDeposit.objects.select_for_update()
                    .filter(status='PENDING', unique_amount=amount)
                    .select_related('user')
                    .order_by('created_at')
                    .first()
                )
                if session:
                    ok = _credit_pending_session(
                        session,
                        utr=utr,
                        phonepe_amount=amount,
                        party_name=party,
                        txn_type=txn_type,
                        payment_time=payment_time,
                        raw_payload=raw,
                    )
                    if ok:
                        credited += 1
                    else:
                        skipped += 1
                else:
                    AutoDepositTransaction.objects.update_or_create(
                        utr=utr,
                        defaults={
                            'amount': amount,
                            'party_name': party[:255],
                            'txn_type': (txn_type or 'Received from')[:64],
                            'user': None,
                            'status': 'UNMATCHED',
                            'payment_time': payment_time,
                            'raw_payload': raw,
                        },
                    )
                    unmatched += 1
        except Exception as exc:
            logger.exception('Failed ingesting PhonePe txn utr=%s: %s', utr, exc)
            errors.append(f'{utr}: {exc}')

    return {
        'credited': credited,
        'unmatched': unmatched,
        'skipped': skipped,
        'errors': errors,
    }


def make_callback_token(session: PendingAutoDeposit) -> str:
    """
    Per-session token for UPI Intent callback after PhonePe returns.
    Survives JWT expiry while the player is inside PhonePe/GPay.
    """
    import hashlib
    import hmac
    from django.conf import settings

    raw = f'{session.id}:{session.user_id}:{session.unique_amount}:{session.expires_at.isoformat()}'
    return hmac.new(
        str(settings.SECRET_KEY).encode('utf-8'),
        raw.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()[:40]


def verify_callback_token(session: PendingAutoDeposit, token: str) -> bool:
    if not token:
        return False
    expected = make_callback_token(session)
    import hmac as hmac_mod
    return hmac_mod.compare_digest(str(token).strip(), expected)


def session_status_payload(session: PendingAutoDeposit) -> dict:
    expire_stale_sessions()
    session.refresh_from_db()
    return {
        'session_id': session.id,
        'status': session.status,
        'requested_amount': int(session.requested_amount),
        'unique_amount': str(session.unique_amount),
        'utr': session.utr or '',
        'expires_at': session.expires_at.isoformat() if session.expires_at else None,
        'credited_at': session.credited_at.isoformat() if session.credited_at else None,
        'payment_method_id': session.payment_method_id,
        # Send with UPI callback if JWT may expire during payment
        'callback_token': make_callback_token(session) if session.status == 'PENDING' else '',
    }


def pending_trigger_payload() -> dict:
    """Used by PhonePe Sync companion to know when to auto-fetch History."""
    expire_stale_sessions()
    qs = PendingAutoDeposit.objects.filter(status='PENDING').order_by('-id')
    count = qs.count()
    latest = qs.first()
    # 1 pending → check last 1 PhonePe txn; 2 pending → last 2; capped at 5 to keep it fast
    fetch_limit = max(0, min(int(count), 5))
    # All pending unique amounts so companion can pre-filter History list
    pending_amounts = [str(p.unique_amount) for p in qs[:10]]
    return {
        'ok': True,
        'needs_fetch': count > 0,
        'pending_count': count,
        'latest_id': latest.id if latest else 0,
        'latest_unique_amount': str(latest.unique_amount) if latest else None,
        'latest_created_at': latest.created_at.isoformat() if latest else None,
        'fetch_limit': fetch_limit,
        'pending_amounts': pending_amounts,
    }


def companion_heartbeat(device_id: str, version: str = '') -> None:
    """Record companion last-seen ping. Stores in a settings-like key via cache or simple model."""
    import json
    from django.core.cache import cache
    info = {'device_id': device_id, 'version': version, 'last_seen': timezone.now().isoformat()}
    cache.set('companion_heartbeat', json.dumps(info), timeout=600)


def companion_status() -> dict:
    """Return companion online status for admin dashboard."""
    import json
    from django.core.cache import cache
    raw = cache.get('companion_heartbeat')
    if not raw:
        return {'online': False, 'last_seen': None, 'device_id': None, 'version': None}
    try:
        info = json.loads(raw)
        last_seen = info.get('last_seen')
        # Consider online if seen within 3 minutes
        if last_seen:
            from datetime import datetime, timezone as dt_tz
            dt = datetime.fromisoformat(last_seen)
            age = (timezone.now() - dt).total_seconds()
            online = age < 180
        else:
            online = False
        return {'online': online, 'last_seen': last_seen, 'device_id': info.get('device_id'), 'version': info.get('version')}
    except Exception:
        return {'online': False, 'last_seen': None, 'device_id': None, 'version': None}


def pending_auto_deposits_list() -> list[dict]:
    """Return all PENDING auto deposits for admin panel."""
    expire_stale_sessions()
    rows = []
    for p in PendingAutoDeposit.objects.filter(status='PENDING').select_related('user').order_by('-id'):
        rows.append({
            'id': p.id,
            'username': p.user.username if p.user else '—',
            'requested_amount': int(p.requested_amount),
            'unique_amount': str(p.unique_amount),
            'created_at': p.created_at.isoformat(),
            'expires_at': p.expires_at.isoformat() if p.expires_at else None,
        })
    return rows


def today_credit_utrs() -> list[dict]:
    """
    Return all credit transactions synced from PhonePe today (IST).
    Used by admin panel UTR log viewer.
    """
    today = timezone.now().date()
    rows = []
    qs = AutoDepositTransaction.objects.filter(
        payment_time__date=today,
    ).order_by('-payment_time')
    for t in qs:
        rows.append({
            'utr': t.utr,
            'amount': str(t.amount),
            'party_name': t.party_name or '—',
            'txn_type': t.txn_type or 'Received from',
            'status': t.status,
            'username': t.user.username if t.user_id else '—',
            'payment_time': t.payment_time.isoformat(),
        })
    return rows
