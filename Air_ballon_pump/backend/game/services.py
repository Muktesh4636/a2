import secrets
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import Player, Round

CFG = settings.GAME


class GameError(Exception):
    def __init__(self, message, code="error", status=400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def clamp_bet(value) -> Decimal:
    try:
        n = Decimal(str(value))
    except Exception as exc:
        raise GameError("Invalid bet amount") from exc

    step = Decimal(CFG["BET_STEP"])
    n = (n / step).to_integral_value(rounding=ROUND_HALF_UP) * step
    n = max(Decimal(CFG["MIN_BET"]), min(Decimal(CFG["MAX_BET"]), n))
    return money(n)


def generate_crash_point() -> float:
    # Same curve as the frontend: almost always survives the first gulp
    r = max(1e-9, secrets.SystemRandom().random())
    crash = max(CFG["MIN_CRASH"], min(0.97 / r, CFG["MAX_CRASH"]))
    return round(crash, 4)


def next_multiplier(pumps: int) -> float:
    base = CFG["BASE_MULTIPLIER"]
    growth = CFG["MULTIPLIER_GROWTH"]
    return round(base + pumps * growth + pumps * pumps * 0.012, 2)


def get_or_create_player(token: str) -> Player:
    player, _ = Player.objects.get_or_create(
        token=token,
        defaults={"balance": money(CFG["START_BALANCE"])},
    )
    return player


def active_round(player: Player) -> Round | None:
    return (
        player.rounds.filter(status=Round.Status.PLAYING)
        .order_by("-created_at")
        .first()
    )


def history_payload(player: Player) -> list[dict]:
    qs = player.rounds.exclude(status=Round.Status.PLAYING).order_by("-ended_at")[
        : CFG["MAX_HISTORY"]
    ]
    items = []
    for rnd in qs:
        if rnd.status == Round.Status.CRASHED:
            items.append({"value": rnd.crash_at, "crashed": True})
        else:
            items.append({"value": rnd.multiplier, "crashed": False})
    return items


def player_state(player: Player) -> dict:
    rnd = active_round(player)
    cooldown_ms = player.cooldown_remaining_ms
    phase = "playing" if rnd else ("ended" if player.rounds.exists() else "idle")

    payload = {
        "balance": float(player.balance),
        "phase": phase if cooldown_ms == 0 or rnd else phase,
        "cooldown_ms": cooldown_ms,
        "cooldown": cooldown_ms > 0,
        "min_bet": CFG["MIN_BET"],
        "max_bet": CFG["MAX_BET"],
        "bet_step": CFG["BET_STEP"],
        "round_gap_seconds": CFG["ROUND_GAP_SECONDS"],
        "history": history_payload(player),
        "round": None,
    }

    if rnd:
        payload["phase"] = "playing"
        payload["round"] = {
            "id": rnd.id,
            "bet": float(rnd.bet),
            "pumps": rnd.pumps,
            "multiplier": rnd.multiplier,
            "potential_win": float(money(rnd.bet * Decimal(str(rnd.multiplier)))),
        }
    elif player.rounds.exists():
        last = player.rounds.exclude(status=Round.Status.PLAYING).first()
        payload["phase"] = "ended"
        payload["last_result"] = {
            "status": last.status,
            "multiplier": last.multiplier,
            "crash_at": last.crash_at if last.status == Round.Status.CRASHED else None,
            "payout": float(last.payout),
            "bet": float(last.bet),
        }

    return payload


def ensure_no_cooldown(player: Player):
    remaining = player.cooldown_remaining_ms
    if remaining > 0:
        secs = max(1, (remaining + 999) // 1000)
        raise GameError(
            f"Next game in {secs}s",
            code="cooldown",
            status=429,
        )


def begin_cooldown(player: Player):
    player.cooldown_until = timezone.now() + timedelta(seconds=CFG["ROUND_GAP_SECONDS"])
    player.save(update_fields=["cooldown_until", "updated_at"])


@transaction.atomic
def start_round(player: Player, bet_value) -> dict:
    ensure_no_cooldown(player)

    if active_round(player):
        raise GameError("A round is already in progress", code="round_active")

    bet = clamp_bet(bet_value)
    player = Player.objects.select_for_update().get(pk=player.pk)

    if player.balance < bet:
        raise GameError("Not enough balance for that bet", code="insufficient_balance")

    player.balance = money(player.balance - bet)
    player.cooldown_until = None
    player.save(update_fields=["balance", "cooldown_until", "updated_at"])

    rnd = Round.objects.create(
        player=player,
        bet=bet,
        crash_at=generate_crash_point(),
        pumps=0,
        multiplier=CFG["BASE_MULTIPLIER"],
        status=Round.Status.PLAYING,
    )

    state = player_state(player)
    state["message"] = "Push the pump — air fills the balloon"
    state["round"] = {
        "id": rnd.id,
        "bet": float(rnd.bet),
        "pumps": 0,
        "multiplier": rnd.multiplier,
        "potential_win": float(bet),
    }
    return state


@transaction.atomic
def pump_round(player: Player) -> dict:
    player = Player.objects.select_for_update().get(pk=player.pk)
    rnd = active_round(player)
    if not rnd:
        raise GameError("No active round", code="no_round")

    rnd = Round.objects.select_for_update().get(pk=rnd.pk)
    next_m = next_multiplier(rnd.pumps + 1)
    rnd.pumps += 1

    if next_m >= rnd.crash_at:
        rnd.multiplier = next_m
        rnd.status = Round.Status.CRASHED
        rnd.payout = money(0)
        rnd.ended_at = timezone.now()
        rnd.save()
        begin_cooldown(player)

        state = player_state(player)
        state["event"] = "crashed"
        state["message"] = f"Balloon blasted at {rnd.crash_at:.2f}x — bet lost"
        state["crash_at"] = rnd.crash_at
        state["multiplier"] = next_m
        state["pumps"] = rnd.pumps
        return state

    rnd.multiplier = next_m
    rnd.save(update_fields=["pumps", "multiplier"])

    state = player_state(player)
    state["event"] = "pumped"
    state["message"] = f"Air in — {next_m:.2f}x. Pump again or cash out"
    return state


@transaction.atomic
def cashout_round(player: Player) -> dict:
    player = Player.objects.select_for_update().get(pk=player.pk)
    rnd = active_round(player)
    if not rnd:
        raise GameError("No active round", code="no_round")

    rnd = Round.objects.select_for_update().get(pk=rnd.pk)
    payout = money(rnd.bet * Decimal(str(rnd.multiplier)))
    player.balance = money(player.balance + payout)
    player.save(update_fields=["balance", "updated_at"])

    rnd.status = Round.Status.CASHED
    rnd.payout = payout
    rnd.ended_at = timezone.now()
    rnd.save()
    begin_cooldown(player)

    state = player_state(player)
    state["event"] = "cashed"
    state["message"] = f"Cashed out ₹{payout} at {rnd.multiplier:.2f}x"
    state["payout"] = float(payout)
    return state
