"""
Shared roulette timer — one continuous game for all users.

  betting  (7s)  → place bets
  spinning (16s) → shared number drawn + all pending bets settled; clients animate
  result   (10s) → zoom / result window
  → back to betting
"""

from __future__ import annotations

import logging
import secrets
import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from game import roulette_engine as engine
from game import roulette_services as services

logger = logging.getLogger("game.roulette_timer")


class Command(BaseCommand):
    help = "Runs the shared roulette round timer (same game for every user)"

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS("Roulette shared timer started"))
        # Ensure state exists
        engine.load_state()

        while True:
            try:
                # Long-running loop: refresh stale DB connections each tick
                close_old_connections()
                self._tick()
            except Exception as exc:
                logger.exception("roulette timer tick failed: %s", exc)
                self.stdout.write(self.style.ERROR(f"tick error: {exc}"))
                close_old_connections()
            time.sleep(0.2)

    def _tick(self):
        st = engine.load_state()
        now = st["server_now"]
        ends = float(st.get("phase_ends_at") or now)
        if now < ends:
            return

        phase = st.get("phase") or engine.PHASE_BETTING

        if phase == engine.PHASE_BETTING:
            number = secrets.randbelow(37)
            rnd = int(st.get("round") or 1)
            settled = 0
            try:
                settled = services.settle_all_pending_for_number(number, rnd)
            except Exception as exc:
                # Never block the shared clock — clients must still auto-spin
                logger.exception("settle failed round=%s number=%s: %s", rnd, number, exc)
                self.stdout.write(self.style.ERROR(f"settle error: {exc}"))
                close_old_connections()

            st["phase"] = engine.PHASE_SPINNING
            st["phase_ends_at"] = now + engine.SPINNING_SECONDS
            st["number"] = number
            st["last_number"] = number
            engine.save_state(st)
            msg = f"round {rnd} SPIN number={number} settled_users={settled}"
            logger.info(msg)
            self.stdout.write(self.style.SUCCESS(msg))
            return

        if phase == engine.PHASE_SPINNING:
            st["phase"] = engine.PHASE_RESULT
            st["phase_ends_at"] = now + engine.RESULT_SECONDS
            engine.save_state(st)
            self.stdout.write(self.style.WARNING(f"round {st.get('round')} RESULT window"))
            return

        # result → next betting window
        st["phase"] = engine.PHASE_BETTING
        st["phase_ends_at"] = now + engine.BETTING_SECONDS
        st["number"] = None
        st["round"] = int(st.get("round") or 1) + 1
        engine.save_state(st)
        self.stdout.write(self.style.SUCCESS(f"round {st['round']} BETTING open ({engine.BETTING_SECONDS}s)"))
