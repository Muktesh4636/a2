"""
Management command: sync_sports_data
====================================
Syncs Soccer (Football) + Tennis from DafaBet into Redis — same two-speed
pattern as sync_cricket_data:

  FAST (every 2s)  — /live/changes price deltas
  FULL (every 30s) — full /events refresh
  UPCOMING (120s)  — pre-match list

Usage:
  python manage.py sync_sports_data
  python manage.py sync_sports_data --sports soccer,tennis
  python manage.py sync_sports_data --once
"""

import logging
import signal
import time

from django.core.management.base import BaseCommand

logger = logging.getLogger("game")

DELTA_INTERVAL_DEFAULT = 2
FULL_INTERVAL_DEFAULT = 30
UPCOMING_INTERVAL = 120


class Command(BaseCommand):
    help = "Sync Soccer + Tennis live/upcoming data from DafaBet into Redis"

    def add_arguments(self, parser):
        parser.add_argument(
            "--delta-interval", type=int, default=DELTA_INTERVAL_DEFAULT,
            help=f"Seconds between delta polls (default: {DELTA_INTERVAL_DEFAULT})",
        )
        parser.add_argument(
            "--full-interval", type=int, default=FULL_INTERVAL_DEFAULT,
            help=f"Seconds between full refreshes (default: {FULL_INTERVAL_DEFAULT})",
        )
        parser.add_argument(
            "--sports", type=str, default="soccer,tennis",
            help="Comma-separated sports to sync (default: soccer,tennis)",
        )
        parser.add_argument(
            "--once", action="store_true", default=False,
            help="Run one full + one delta then exit",
        )

    def handle(self, *args, **options):
        from game import sports_feed as feed

        delta_interval = options["delta_interval"]
        full_interval = options["full_interval"]
        once = options["once"]
        sports = [s.strip().lower() for s in options["sports"].split(",") if s.strip()]
        for s in sports:
            feed.get_sport_config(s)  # validate early

        self._running = True
        signal.signal(signal.SIGTERM, self._stop)
        signal.signal(signal.SIGINT, self._stop)

        self.stdout.write(self.style.SUCCESS(
            f"Sports sync starting — sports={sports} "
            f"delta={delta_interval}s full={full_interval}s"
        ))
        logger.info("Sports sync started sports=%s", sports)

        last_full = {s: 0 for s in sports}
        last_upcoming = {s: 0 for s in sports}
        last_bn = {s: "-1" for s in sports}
        iteration = 0

        while self._running:
            iteration += 1
            t0 = time.time()
            now = t0

            for sport in sports:
                keys = feed._keys(sport)

                # Upcoming
                if now - last_upcoming[sport] >= UPCOMING_INTERVAL:
                    try:
                        ures = feed.fetch_and_cache_upcoming(sport)
                        if ures.get("ok"):
                            last_upcoming[sport] = now
                            self.stdout.write(self.style.SUCCESS(
                                f"[#{iteration}] {sport.upper()} UPCOMING — {ures['matches']} matches"
                            ))
                    except Exception as exc:
                        logger.exception("%s upcoming error: %s", sport, exc)

                # Full refresh
                if now - last_full[sport] >= full_interval:
                    try:
                        result = feed.fetch_and_cache_live(sport)
                        elapsed = time.time() - t0
                        if result.get("ok"):
                            last_full[sport] = now
                            last_bn[sport] = feed.cache_get(keys["sync_bn"]) or "-1"
                            self.stdout.write(self.style.SUCCESS(
                                f"[#{iteration}] {sport.upper()} FULL — "
                                f"{result['matches']} matches, {result['markets']} markets "
                                f"— {elapsed:.2f}s"
                            ))
                        else:
                            self.stdout.write(self.style.WARNING(
                                f"[#{iteration}] {sport.upper()} FULL failed — {elapsed:.2f}s"
                            ))
                    except Exception as exc:
                        logger.exception("%s full sync error: %s", sport, exc)
                        self.stdout.write(self.style.ERROR(
                            f"[#{iteration}] {sport.upper()} FULL error: {exc}"
                        ))
                else:
                    # Delta
                    try:
                        next_bn, n_changes, err = feed.poll_delta(sport, last_bn[sport])
                        elapsed = time.time() - t0
                        if err:
                            code = (err or {}).get("status_code") or 0
                            if code in (400, 502):
                                last_bn[sport] = "-1"
                                feed.cache_set(keys["sync_bn"], "-1", 3600)
                            self.stdout.write(self.style.WARNING(
                                f"[#{iteration}] {sport.upper()} DELTA failed "
                                f"({err}) — {elapsed:.2f}s"
                            ))
                        else:
                            last_bn[sport] = next_bn
                            self.stdout.write(self.style.SUCCESS(
                                f"[#{iteration}] {sport.upper()} DELTA — "
                                f"{n_changes} price changes — {elapsed:.2f}s"
                            ))
                    except Exception as exc:
                        logger.exception("%s delta error: %s", sport, exc)

            if once or not self._running:
                break

            elapsed = time.time() - t0
            remaining = delta_interval - elapsed
            if remaining > 0:
                deadline = time.time() + remaining
                while self._running and time.time() < deadline:
                    time.sleep(0.1)

        self.stdout.write(self.style.SUCCESS("Sports sync worker stopped."))
        logger.info("Sports sync worker stopped")

    def _stop(self, *_):
        self.stdout.write("\nShutting down sports sync worker...")
        self._running = False
