"""
Management command: sync_cricket_data
======================================
Smart two-speed sync worker:

  FAST (every 2s) — calls /live/changes?bn=<last_bn>
      Gets ONLY what changed since the last poll (price diffs).
      Applies changed prices directly to the Redis cache.
      Tiny payload (~1-5 KB). No full fetch.

  FULL (every 30s) — calls /events with all markets
      Refreshes scores, innings, new markets, match list.
      Replaces the whole Redis cache.

This means:
  - Odds update every ~2 seconds with minimal data transfer
  - Scores + match structure update every 30 seconds

Usage:
  python manage.py sync_cricket_data
  python manage.py sync_cricket_data --delta-interval 2 --full-interval 30
  python manage.py sync_cricket_data --once   (one full + one delta then exit)
"""

import json
import logging
import signal
import time

from django.core.management.base import BaseCommand

logger = logging.getLogger("game")

DELTA_INTERVAL_DEFAULT = 2   # seconds between delta (changes) polls
FULL_INTERVAL_DEFAULT  = 30  # seconds between full refreshes


class Command(BaseCommand):
    help = (
        "Smart cricket sync: delta odds every 2s via /live/changes, "
        "full refresh every 30s via /events"
    )

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
            "--once", action="store_true", default=False,
            help="Run one full sync + one delta then exit",
        )

    def handle(self, *args, **options):
        delta_interval = options["delta_interval"]
        full_interval  = options["full_interval"]
        once           = options["once"]

        self._running = True
        signal.signal(signal.SIGTERM, self._stop)
        signal.signal(signal.SIGINT,  self._stop)

        self.stdout.write(self.style.SUCCESS(
            f"Cricket sync worker starting — "
            f"delta every {delta_interval}s, full every {full_interval}s"
        ))
        logger.info(
            "Cricket sync worker started (delta=%ds, full=%ds)",
            delta_interval, full_interval,
        )

        from game.cricket_views import (
            fetch_and_cache_cricket_data,
            fetch_and_cache_upcoming_matches,
            refresh_pending_bet_results,
            _fetch, _cache_get, _cache_set,
            REDIS_KEY_MATCHES, REDIS_KEY_SCORES, REDIS_KEY_ODDS,
            REDIS_KEY_SYNC_TS, REDIS_KEY_SYNC_BN,
            REDIS_TTL,
            _CRICKET_PATH_ID, _CRICKET_MARKET_TYPE_IDS, _CRICKET_PERIOD_TYPE_IDS,
            _BASE,
        )

        UPCOMING_INTERVAL = 120   # refresh upcoming matches every 2 minutes
        RESULT_INTERVAL   = 60    # refresh results + settle pending bets every 1 minute
        OPENSOURCE_INTERVAL = 20  # public Cricbuzz score scrape

        last_full_time     = 0   # force full refresh on first iteration
        last_upcoming_time = 0   # force upcoming refresh on first iteration
        last_result_time   = 0
        last_opensource_time = 0
        last_bn            = "-1"
        iteration          = 0

        while self._running:
            iteration += 1
            t0   = time.time()
            now  = t0

            # ----------------------------------------------------------------
            # OPEN-SOURCE SCORES — Cricbuzz scrape every ~20s
            # ----------------------------------------------------------------
            if now - last_opensource_time >= OPENSOURCE_INTERVAL:
                try:
                    from game.cricket_opensource import fetch_opensource_live_scores
                    ores = fetch_opensource_live_scores()
                    last_opensource_time = now
                    if ores.get("ok"):
                        self.stdout.write(self.style.SUCCESS(
                            f"[#{iteration}] OPENSOURCE — "
                            f"{ores.get('live_count', 0)} live / "
                            f"{ores.get('match_count', 0)} total"
                        ))
                    else:
                        self.stdout.write(self.style.WARNING(
                            f"[#{iteration}] OPENSOURCE failed — {ores.get('error')}"
                        ))
                except Exception as exc:
                    logger.exception("Opensource cricket sync error: %s", exc)

            # ----------------------------------------------------------------
            # UPCOMING REFRESH — every 2 minutes
            # ----------------------------------------------------------------
            if now - last_upcoming_time >= UPCOMING_INTERVAL:
                try:
                    ures = fetch_and_cache_upcoming_matches()
                    if ures.get("ok"):
                        last_upcoming_time = now
                        self.stdout.write(self.style.SUCCESS(
                            f"[#{iteration}] UPCOMING — {ures['matches']} matches"
                        ))
                except Exception as exc:
                    logger.exception("Upcoming sync error: %s", exc)

            # ----------------------------------------------------------------
            # RESULTS + SETTLEMENT — every 60 seconds
            # Uses Dafabet outcome.result only (WIN / LOSE / VOID)
            # ----------------------------------------------------------------
            if now - last_result_time >= RESULT_INTERVAL:
                try:
                    rres = refresh_pending_bet_results()
                    last_result_time = now
                    settle = rres.get("settle") or {}
                    self.stdout.write(self.style.SUCCESS(
                        f"[#{iteration}] RESULTS — events={rres.get('events', 0)} "
                        f"final={((rres.get('ingest') or {}).get('final', 0))} "
                        f"settled={settle.get('settled', 0)} "
                        f"(W{settle.get('won', 0)}/L{settle.get('lost', 0)}/V{settle.get('void', 0)})"
                    ))
                except Exception as exc:
                    logger.exception("Result sync/settle error: %s", exc)

            # ----------------------------------------------------------------
            # FULL REFRESH — every full_interval seconds
            # ----------------------------------------------------------------
            if now - last_full_time >= full_interval:
                try:
                    result = fetch_and_cache_cricket_data()
                    elapsed = time.time() - t0

                    if result.get("ok"):
                        last_full_time = now
                        # Reset bn so next delta starts fresh
                        last_bn = _cache_get(REDIS_KEY_SYNC_BN) or "-1"
                        self.stdout.write(self.style.SUCCESS(
                            f"[#{iteration}] FULL — "
                            f"{result['matches']} matches, "
                            f"{result['markets']} markets — "
                            f"{elapsed:.2f}s"
                        ))
                    else:
                        self.stdout.write(self.style.WARNING(
                            f"[#{iteration}] FULL failed — {elapsed:.2f}s"
                        ))
                except Exception as exc:
                    logger.exception("Full sync error: %s", exc)
                    self.stdout.write(self.style.ERROR(f"[#{iteration}] FULL error: {exc}"))

            # ----------------------------------------------------------------
            # DELTA REFRESH — every delta_interval seconds (between full syncs)
            # ----------------------------------------------------------------
            else:
                try:
                    data, err = _fetch(f"{_BASE}/live/changes", {
                        "eventPathId": _CRICKET_PATH_ID,
                        "marketTypeIds": _CRICKET_MARKET_TYPE_IDS,
                        "periodTypeIds": _CRICKET_PERIOD_TYPE_IDS,
                        "includeOpponentMarkets": "true",
                        "bn": last_bn,
                        "v": "2",
                    })

                    elapsed = time.time() - t0

                    if err or data is None:
                        # Stale batch / upstream errors — reset bn so next delta recovers
                        detail = ""
                        code = 0
                        if hasattr(err, "data") and isinstance(getattr(err, "data", None), dict):
                            detail = str(err.data.get("detail", ""))
                            code = int(err.data.get("status_code") or 0)
                        err_str = detail or str(err or "")
                        if code in (400, 502) or "400" in err_str or "502" in err_str:
                            last_bn = "-1"
                            _cache_set(REDIS_KEY_SYNC_BN, "-1", 3600)
                        self.stdout.write(self.style.WARNING(
                            f"[#{iteration}] DELTA failed ({err_str[:40]}) — {elapsed:.2f}s"
                        ))
                    else:
                        items = data if isinstance(data, list) else []

                        # Extract next batch number
                        next_bn = next(
                            (str(i.get("bn")) for i in items if i.get("t") == "b"),
                            None,
                        )
                        if next_bn:
                            last_bn = next_bn
                            _cache_set(REDIS_KEY_SYNC_BN, next_bn, 3600)

                        # Price changes only
                        price_changes = [i for i in items if i.get("t") == "p"]

                        if price_changes:
                            _apply_price_changes(
                                price_changes,
                                REDIS_KEY_MATCHES, REDIS_KEY_ODDS, REDIS_TTL,
                                _cache_get, _cache_set,
                            )

                        self.stdout.write(self.style.SUCCESS(
                            f"[#{iteration}] DELTA — "
                            f"{len(price_changes)} price changes — "
                            f"{elapsed:.2f}s"
                        ))

                except Exception as exc:
                    logger.exception("Delta sync error: %s", exc)
                    self.stdout.write(self.style.ERROR(
                        f"[#{iteration}] DELTA error: {exc}"
                    ))

            if once or not self._running:
                break

            # Sleep delta_interval, waking every 0.1s for clean shutdown
            elapsed   = time.time() - t0
            remaining = delta_interval - elapsed
            if remaining > 0:
                deadline = time.time() + remaining
                while self._running and time.time() < deadline:
                    time.sleep(0.1)

        self.stdout.write(self.style.SUCCESS("Cricket sync worker stopped."))
        logger.info("Cricket sync worker stopped")

    def _stop(self, *_):
        self.stdout.write("\nShutting down cricket sync worker...")
        self._running = False


# ---------------------------------------------------------------------------
# Delta price application (module-level so it's easy to test)
# ---------------------------------------------------------------------------

def _apply_price_changes(price_changes, key_matches, key_odds, ttl, cache_get, cache_set):
    """
    Given a list of Dafabet price-change objects, update the outcome prices
    in the Redis-cached matches and odds data without touching anything else.

    Each price change looks like:
      { "id": <outcome_id>, "eid": <event_id>, "mid": <market_id>,
        "t": "p", "clp": {"cp": {"d": 1.75, "f": "1.75"}}, "h": false }
    """
    # Build a lookup: outcome_id -> (new_decimal, new_formatted, hidden)
    updates: dict[int, tuple] = {}
    for c in price_changes:
        oid = c.get("id")
        cp  = (c.get("clp") or {}).get("cp") or {}
        if oid and cp.get("d") is not None:
            updates[oid] = (cp["d"], cp.get("f"), c.get("h", False))

    if not updates:
        return

    changed_matches = 0
    changed_outcomes = 0

    for cache_key in (key_matches, key_odds):
        cached = cache_get(cache_key)
        if not cached:
            continue

        dirty = False
        for match in cached:
            odds = match.get("odds") or {}
            for market in odds.get("markets") or []:
                for outcome in market.get("outcomes") or []:
                    oid = outcome.get("id")
                    if oid in updates:
                        new_dec, new_fmt, hidden = updates[oid]
                        # Save previous price before overwriting
                        outcome["prev_price_decimal"]   = outcome.get("price_decimal")
                        outcome["prev_price_formatted"]  = outcome.get("price_formatted")
                        outcome["price_decimal"]         = new_dec
                        outcome["price_formatted"]       = new_fmt
                        outcome["hidden"]                = hidden
                        dirty = True
                        changed_outcomes += 1

            if dirty:
                changed_matches += 1

        if dirty:
            cache_set(cache_key, cached, ttl)

    logger.debug(
        "Delta applied: %d outcomes updated across %d matches",
        changed_outcomes, changed_matches,
    )
    return changed_outcomes
