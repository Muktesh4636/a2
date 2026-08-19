from __future__ import annotations

import json
import mimetypes
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from . import logic
from .models import GameSession


def _json_body(request) -> dict:
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _ensure_session(request) -> GameSession:
    if not request.session.session_key:
        request.session.create()
    key = request.session.session_key
    obj, _ = GameSession.objects.get_or_create(
        session_key=key,
        defaults={
            "balance": Decimal(str(settings.DEMO_BALANCE)),
            "bet": Decimal(str(settings.DEFAULT_BET)),
        },
    )
    return obj


def _fill_of(session: GameSession) -> dict:
    return {"water": session.water, "earth": session.earth, "fire": session.fire}


def _set_fill(session: GameSession, fill: dict) -> None:
    session.water = fill["water"]
    session.earth = fill["earth"]
    session.fire = fill["fire"]


@require_GET
def state(request):
    session = _ensure_session(request)
    return JsonResponse(logic.session_snapshot(session))


@csrf_exempt
@require_http_methods(["POST"])
def set_bet(request):
    session = _ensure_session(request)
    body = _json_body(request)
    try:
        bet = logic.money(body.get("bet", session.bet))
    except (InvalidOperation, TypeError, ValueError):
        return JsonResponse({"ok": False, "error": "Invalid bet"}, status=400)

    if bet < Decimal(str(settings.MIN_BET)) or bet > Decimal(str(settings.MAX_BET)):
        return JsonResponse(
            {
                "ok": False,
                "error": f"Bet must be between {settings.MIN_BET} and {settings.MAX_BET}",
            },
            status=400,
        )

    session.bet = bet
    session.save(update_fields=["bet", "updated_at"])
    return JsonResponse(logic.session_snapshot(session))


@csrf_exempt
@require_http_methods(["POST"])
def spin(request):
    session = _ensure_session(request)
    # Clear a stale lock from a previous failed request
    if session.busy:
        session.busy = False
        session.save(update_fields=["busy", "updated_at"])

    if session.balance < session.bet:
        snap = logic.session_snapshot(session, message="Not enough balance")
        snap["ok"] = False
        snap["error"] = "Not enough balance"
        return JsonResponse(snap, status=400)

    session.busy = True
    session.balance = logic.money(session.balance - session.bet)
    session.save(update_fields=["busy", "balance", "updated_at"])

    try:
        prev = _fill_of(session)
        fill = dict(prev)
        drop = logic.pick_drop()
        message = None
        extra = {"bonus": None, "sector_mult": None, "changed": []}

        if drop == "wind":
            message = "Wind — rings unchanged"
            extra["changed"] = []
        elif drop == "skull":
            fill = logic.apply_rollback(fill)
            extra["changed"] = [k for k in logic.RING_KEYS if fill[k] != prev[k]]
            if extra["changed"]:
                parts = []
                for k in extra["changed"]:
                    before_m = logic.current_mult(prev, k)
                    after_m = logic.current_mult(fill, k)
                    if after_m > 0:
                        parts.append(
                            f"{logic.RINGS[k]['label']} {logic.format_mult(before_m)}X→{logic.format_mult(after_m)}X"
                        )
                    else:
                        parts.append(f"{logic.RINGS[k]['label']} cleared")
                message = "Skull −1 · " + ", ".join(parts)
            else:
                message = "Skull — nothing to decrease"
        else:
            key, steps = logic.parse_drop(drop)
            if key is None:
                message = "Unknown symbol"
            else:
                fill, bonus, sector_mult = logic.apply_advance(fill, key, steps)
                extra["sector_mult"] = sector_mult
                extra["changed"] = [key]
                if bonus:
                    win_mult = logic.roll_bonus(key)
                    win = logic.money(session.bet * Decimal(str(win_mult)))
                    session.balance = logic.money(session.balance + win)
                    fill[key] = 0
                    extra["bonus"] = {
                        "ring": key,
                        "mult": win_mult,
                        "win": float(win),
                    }
                    message = f"{logic.RINGS[key]['label']} BONUS +${win} ({win_mult}X)"
                else:
                    mult = sector_mult
                    payout = logic.money(session.bet * Decimal(str(logic.total_mult(fill))))
                    message = (
                        f"{logic.RINGS[key]['label']} → {logic.format_mult(mult)}X"
                        f"  (total {logic.format_mult(logic.total_mult(fill))}X · ${payout})"
                    )

        _set_fill(session, fill)
        session.busy = False
        session.save()
        return JsonResponse(
            logic.session_snapshot(session, message=message, drop=drop, extra=extra)
        )
    except Exception:
        session.busy = False
        session.save(update_fields=["busy", "updated_at"])
        raise


@csrf_exempt
@require_http_methods(["POST"])
def cashout(request):
    session = _ensure_session(request)
    fill = _fill_of(session)
    if sum(fill.values()) <= 0:
        return JsonResponse({"ok": False, "error": "Nothing to cash out"}, status=400)

    mult = logic.total_mult(fill)
    amount = logic.money(session.bet * Decimal(str(mult)))
    session.balance = logic.money(session.balance + amount)
    _set_fill(session, {"water": 0, "earth": 0, "fire": 0})
    session.save()
    return JsonResponse(
        logic.session_snapshot(
            session,
            message=f"Cash Out +${amount} ({mult}X)",
            extra={"cashed": float(amount)},
        )
    )


@csrf_exempt
@require_http_methods(["POST"])
def part(request):
    session = _ensure_session(request)
    fill = _fill_of(session)
    if not logic.can_part(fill):
        return JsonResponse({"ok": False, "error": "Part payout unavailable"}, status=400)

    amount = logic.part_amount(fill, session.bet)
    for key in ("water", "earth", "fire"):
        if fill[key] >= 2:
            fill[key] -= 1
    session.balance = logic.money(session.balance + amount)
    _set_fill(session, fill)
    session.save()
    return JsonResponse(
        logic.session_snapshot(
            session,
            message=f"Part Payout +${amount}",
            extra={"cashed": float(amount)},
        )
    )


@csrf_exempt
@require_http_methods(["POST"])
def reset(request):
    """Reset demo session to starting balance and empty rings."""
    session = _ensure_session(request)
    session.balance = Decimal(str(settings.DEMO_BALANCE))
    session.bet = Decimal(str(settings.DEFAULT_BET))
    _set_fill(session, {"water": 0, "earth": 0, "fire": 0})
    session.busy = False
    session.save()
    return JsonResponse(logic.session_snapshot(session, message="Demo reset"))


def frontend(request, path: str = "index.html"):
    """Serve files from frontend/ (HTML, CSS, JS)."""
    root = Path(settings.FRONTEND_DIR).resolve()
    target = (root / path).resolve()
    if target != root and root not in target.parents:
        raise Http404("Invalid path")
    if not target.is_file():
        raise Http404("Not found")

    content_type, _ = mimetypes.guess_type(str(target))
    return FileResponse(target.open("rb"), content_type=content_type or "application/octet-stream")


def images(request, path: str):
    """Serve files from images/."""
    root = Path(settings.IMAGES_DIR).resolve()
    target = (root / path).resolve()
    if target != root and root not in target.parents:
        raise Http404("Invalid path")
    if not target.is_file():
        raise Http404("Not found")

    content_type, _ = mimetypes.guess_type(str(target))
    return FileResponse(target.open("rb"), content_type=content_type or "application/octet-stream")
