import json
import secrets

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .services import (
    GameError,
    cashout_round,
    get_or_create_player,
    player_state,
    pump_round,
    start_round,
)


def _json_body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise GameError("Invalid JSON body") from exc


def _player_token(request) -> str:
    token = request.headers.get("X-Player-Token", "").strip()
    if not token or len(token) < 16:
        token = secrets.token_hex(16)
    return token


def _player(request):
    return get_or_create_player(_player_token(request)), _player_token(request)


def _ok(data, token=None, status=200):
    payload = {"ok": True, **data}
    if token:
        payload["player_token"] = token
    return JsonResponse(payload, status=status)


def _error(exc: GameError, token=None):
    payload = {"ok": False, "error": exc.message, "code": exc.code}
    if token:
        payload["player_token"] = token
    return JsonResponse(payload, status=exc.status)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def bootstrap(request):
    """Create / resume guest player and return current game state."""
    token = _player_token(request)
    player = get_or_create_player(token)
    data = player_state(player)
    return _ok(data, token=token)


@csrf_exempt
@require_GET
def state(request):
    token = _player_token(request)
    player = get_or_create_player(token)
    return _ok(player_state(player), token=token)


@csrf_exempt
@require_POST
def round_start(request):
    token = _player_token(request)
    try:
        body = _json_body(request)
        player = get_or_create_player(token)
        data = start_round(player, body.get("bet", 50))
        return _ok(data, token=token)
    except GameError as exc:
        return _error(exc, token=token)


@csrf_exempt
@require_POST
def round_pump(request):
    token = _player_token(request)
    try:
        player = get_or_create_player(token)
        data = pump_round(player)
        return _ok(data, token=token)
    except GameError as exc:
        return _error(exc, token=token)


@csrf_exempt
@require_POST
def round_cashout(request):
    token = _player_token(request)
    try:
        player = get_or_create_player(token)
        data = cashout_round(player)
        return _ok(data, token=token)
    except GameError as exc:
        return _error(exc, token=token)
