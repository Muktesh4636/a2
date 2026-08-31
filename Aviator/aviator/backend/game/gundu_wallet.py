"""Bridge Aviator crash games to the main Gundu wallet (JWT)."""

from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

logger = logging.getLogger('game')

# Host-published main web port on the app server (dice_game_web → 8001).
# Prefer local main web (host-published :8001). Override with GUNDU_API_BASE if needed.
DEFAULT_GUNDU_API = os.environ.get('GUNDU_API_BASE', 'http://172.17.0.1:8001')


class WalletBridgeError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def extract_bearer(authorization: str | None) -> str:
    if not authorization:
        return ''
    auth = authorization.strip()
    if auth.lower().startswith('bearer '):
        return auth[7:].strip()
    return auth


def jwt_user_id(token: str) -> int | None:
    try:
        part = token.split('.')[1]
        pad = '=' * (-len(part) % 4)
        data = json.loads(base64.urlsafe_b64decode(part + pad))
        uid = data.get('user_id')
        return int(uid) if uid is not None else None
    except Exception:
        return None


def _request_json(method: str, path: str, jwt: str, body: dict | None = None) -> dict[str, Any]:
    url = DEFAULT_GUNDU_API.rstrip('/') + path
    data = None
    headers = {
        'Accept': 'application/json',
        'Authorization': f'Bearer {jwt}',
        # Django rejects Host=172.17.0.1 with 400 unless listed in ALLOWED_HOSTS
        'Host': os.environ.get('GUNDU_API_HOST', 'gunduata.tech'),
    }
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode('utf-8') or '{}'
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode('utf-8') or '{}')
        except Exception:
            payload = {}
        msg = payload.get('error') or payload.get('detail') or e.reason
        raise WalletBridgeError(str(msg), status=e.code) from e
    except Exception as e:
        logger.error('Gundu wallet bridge failed %s %s: %s', method, path, e)
        raise WalletBridgeError('Wallet service unavailable', status=503) from e


def fetch_balance(jwt: str) -> tuple[int, Decimal]:
    """Validate JWT + return (user_id, balance)."""
    data = _request_json('GET', '/api/auth/wallet/', jwt)
    bal = _money(data.get('balance') or 0)
    uid = jwt_user_id(jwt)
    if uid is None:
        raise WalletBridgeError('Invalid session', status=401)
    return uid, bal


def adjust_balance(jwt: str, amount: Decimal, *, game: str, reason: str, ref: str = '') -> Decimal:
    """Signed amount: negative debit, positive credit. Returns new balance."""
    amount_i = int(_money(amount).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    if amount_i == 0 and _money(amount) != 0:
        amount_i = 1 if amount > 0 else -1
    data = _request_json(
        'POST',
        '/api/auth/wallet/game-adjust/',
        jwt,
        {
            'amount': str(amount_i),
            'game': game,
            'reason': reason,
            'ref': ref,
        },
    )
    return _money(data.get('balance') or 0)
