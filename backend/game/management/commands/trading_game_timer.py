"""
Shared trading timer — one continuous market for all users.

  betting  (7s)  → place UP/DOWN bets
  trading (13s)  → shared final_pct + live path; cashout allowed
  result  (2.5s) → settle remaining positions
  → back to betting

This command runs on every app server, but only the instance holding the Redis
clock lock advances the market. The rest idle in standby and take over within
LOCK_TTL_SECONDS if the leader dies.
"""

from __future__ import annotations

import logging
import os
import secrets
import socket
import time
import uuid

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from game import trading_engine as engine
from game import trading_services as services

logger = logging.getLogger("game.trading_timer")

TICK_SECONDS = 0.15
RENEW_EVERY_SECONDS = 2.0
STANDBY_POLL_SECONDS = 1.0
STANDBY_LOG_EVERY_SECONDS = 60.0


class Command(BaseCommand):
    help = "Runs the shared trading round timer (same market for every user)"

    def handle(self, *args, **options):
        token = self._instance_token()
        self.stdout.write(self.style.SUCCESS(f"Trading shared timer starting ({token})"))

        is_leader = False
        last_renew = 0.0
        last_standby_log = -STANDBY_LOG_EVERY_SECONDS

        try:
            while True:
                try:
                    now = time.monotonic()

                    if not is_leader:
                        if not engine.acquire_timer_lock(token):
                            if now - last_standby_log >= STANDBY_LOG_EVERY_SECONDS:
                                last_standby_log = now
                                self._log_standby_reason()
                            time.sleep(STANDBY_POLL_SECONDS)
                            continue
                        is_leader = True
                        last_renew = now
                        engine.write_heartbeat(token)
                        logger.info("trading timer acquired the clock (%s)", token)
                        self.stdout.write(self.style.SUCCESS("Trading timer is now the leader"))
                        self._seed_crowd_if_empty()
                    elif now - last_renew >= RENEW_EVERY_SECONDS:
                        if not engine.renew_timer_lock(token):
                            is_leader = False
                            logger.warning("trading timer lost the clock lock — back to standby")
                            self.stdout.write(self.style.WARNING("Lost clock lock — standby"))
                            continue
                        last_renew = now
                        engine.write_heartbeat(token)

                    close_old_connections()
                    self._tick()
                except Exception as exc:
                    logger.exception("trading timer tick failed: %s", exc)
                    self.stdout.write(self.style.ERROR(f"tick error: {exc}"))
                    close_old_connections()
                time.sleep(TICK_SECONDS)
        finally:
            if is_leader:
                engine.release_timer_lock(token)

    @staticmethod
    def _instance_token() -> str:
        host = os.getenv("SERVER_ID") or socket.gethostname()
        return f"{host}:{os.getpid()}:{uuid.uuid4().hex[:8]}"

    def _log_standby_reason(self):
        if not engine.redis_available():
            logger.error("trading timer cannot reach Redis — market clock is paused")
            self.stdout.write(self.style.ERROR("Redis unavailable — clock paused"))
            return
        holder = engine.timer_heartbeat() or {}
        logger.info("trading timer standby — clock owned by %s", holder.get("owner") or "another instance")

    def _seed_crowd_if_empty(self):
        st = engine.load_state()
        if not (st.get("crowd") or {}).get("up_amount"):
            st.update(engine.seed_crowd())
            engine.save_state(st)

    def _tick(self):
        st = engine.load_state()
        if st.get("redis_down"):
            return

        now = st["server_now"]
        ends = float(st.get("phase_ends_at") or now)
        phase = st.get("phase") or engine.PHASE_BETTING
        rnd = int(st.get("round") or 1)

        # During betting: drift fake crowd so lifeline looks alive
        if phase == engine.PHASE_BETTING and now < ends:
            if secrets.randbelow(100) < 35:
                engine.nudge_crowd(st)
                engine.save_state(st)

        # During trading: keep live_pct in sync with shared path
        if phase == engine.PHASE_TRADING:
            duration = engine.TRADING_SECONDS
            started = ends - duration
            progress = 0.0 if duration <= 0 else max(0.0, min(1.0, (now - started) / duration))
            path = st.get("path") or []
            st["live_pct"] = engine.sample_path(path, progress)
            engine.save_state(st)

        if now < ends:
            return

        gap = now - ends
        if gap > engine.STALE_AFTER_SECONDS:
            logger.warning(
                "trading clock resumed after %.1fs gap (round=%s phase=%s)", gap, rnd, phase
            )

        if phase == engine.PHASE_BETTING:
            final_pct = engine.pick_final_pct()
            seed = secrets.randbelow(1_000_000_000)
            path = engine.generate_path(final_pct, seed)
            st["phase"] = engine.PHASE_TRADING
            st["phase_ends_at"] = now + engine.TRADING_SECONDS
            st["final_pct"] = final_pct
            st["path_seed"] = seed
            st["path"] = path
            st["live_pct"] = float(path[0]) if path else 0.0
            if not engine.save_state_cas(st, engine.PHASE_BETTING, rnd):
                self._log_lost_transition(rnd, phase)
                return
            msg = f"round {rnd} TRADING final={final_pct:+.1f}%"
            logger.info(msg)
            self.stdout.write(self.style.SUCCESS(msg))
            return

        if phase == engine.PHASE_TRADING:
            final_pct = float(st.get("final_pct") or 0)
            st["live_pct"] = final_pct
            st["phase"] = engine.PHASE_RESULT
            st["phase_ends_at"] = now + engine.RESULT_SECONDS
            st["last_pct"] = final_pct
            # Claim the round before paying anyone: only the instance that wins
            # the swap is allowed to settle, so bets can never be settled twice.
            if not engine.save_state_cas(st, engine.PHASE_TRADING, rnd):
                self._log_lost_transition(rnd, phase)
                return

            settled = 0
            try:
                settled = services.settle_all_pending_for_pct(final_pct, rnd)
            except Exception as exc:
                logger.exception("settle failed round=%s pct=%s: %s", rnd, final_pct, exc)
                self.stdout.write(self.style.ERROR(f"settle error: {exc}"))
                close_old_connections()

            msg = f"round {rnd} RESULT final={final_pct:+.1f}% settled_users={settled}"
            logger.info(msg)
            self.stdout.write(self.style.WARNING(msg))
            return

        # result → next betting
        st["phase"] = engine.PHASE_BETTING
        st["phase_ends_at"] = now + engine.BETTING_SECONDS
        st["final_pct"] = None
        st["live_pct"] = 0.0
        st["path"] = []
        st["path_seed"] = 0
        st["round"] = rnd + 1
        st.update(engine.seed_crowd())
        if not engine.save_state_cas(st, engine.PHASE_RESULT, rnd):
            self._log_lost_transition(rnd, phase)
            return
        self.stdout.write(
            self.style.SUCCESS(f"round {st['round']} BETTING open ({engine.BETTING_SECONDS}s)")
        )

    def _log_lost_transition(self, rnd: int, phase: str):
        logger.warning(
            "trading round %s already moved past %s elsewhere — skipped duplicate transition",
            rnd,
            phase,
        )
