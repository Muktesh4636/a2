"""
Shared trading timer — one continuous market for all users.

  betting  (7s)  → place UP/DOWN bets
  trading (10s)  → shared final_pct + live path; cashout allowed
  result  (2.5s) → settle remaining positions
  → back to betting
"""

from __future__ import annotations

import logging
import secrets
import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from game import trading_engine as engine
from game import trading_services as services

logger = logging.getLogger("game.trading_timer")


class Command(BaseCommand):
    help = "Runs the shared trading round timer (same market for every user)"

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS("Trading shared timer started"))
        st0 = engine.load_state()
        if not (st0.get("crowd") or {}).get("up_amount"):
            st0.update(engine.seed_crowd())
            engine.save_state(st0)

        while True:
            try:
                close_old_connections()
                self._tick()
            except Exception as exc:
                logger.exception("trading timer tick failed: %s", exc)
                self.stdout.write(self.style.ERROR(f"tick error: {exc}"))
                close_old_connections()
            time.sleep(0.15)

    def _tick(self):
        st = engine.load_state()
        now = st["server_now"]
        ends = float(st.get("phase_ends_at") or now)
        phase = st.get("phase") or engine.PHASE_BETTING

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
            engine.save_state(st)
            msg = f"round {st.get('round')} TRADING final={final_pct:+.1f}%"
            logger.info(msg)
            self.stdout.write(self.style.SUCCESS(msg))
            return

        if phase == engine.PHASE_TRADING:
            final_pct = float(st.get("final_pct") or 0)
            rnd = int(st.get("round") or 1)
            st["live_pct"] = final_pct
            settled = 0
            try:
                settled = services.settle_all_pending_for_pct(final_pct, rnd)
            except Exception as exc:
                logger.exception("settle failed round=%s pct=%s: %s", rnd, final_pct, exc)
                self.stdout.write(self.style.ERROR(f"settle error: {exc}"))
                close_old_connections()

            st["phase"] = engine.PHASE_RESULT
            st["phase_ends_at"] = now + engine.RESULT_SECONDS
            st["last_pct"] = final_pct
            engine.save_state(st)
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
        st["round"] = int(st.get("round") or 1) + 1
        st.update(engine.seed_crowd())
        engine.save_state(st)
        self.stdout.write(
            self.style.SUCCESS(f"round {st['round']} BETTING open ({engine.BETTING_SECONDS}s)")
        )
