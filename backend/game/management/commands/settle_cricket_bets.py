"""
Settle cricket bets from Dafabet outcome.result (and safe fallbacks).

Usage:
  python manage.py settle_cricket_bets
  python manage.py settle_cricket_bets --orphan-days 3
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Refresh cricket results from Dafa and settle pending user bets"

    def add_arguments(self, parser):
        parser.add_argument(
            "--orphan-days",
            type=int,
            default=7,
            help="Void PENDING bets older than N days with no Dafa result (default 7)",
        )

    def handle(self, *args, **options):
        from game.cricket_views import (
            refresh_pending_bet_results,
            _void_orphaned_pending_bets,
        )

        self.stdout.write("Refreshing Dafa results and settling cricket bets...")
        summary = refresh_pending_bet_results()
        # Allow override of orphan window
        orphan_days = options["orphan_days"]
        if orphan_days != 7:
            extra = _void_orphaned_pending_bets(days=orphan_days)
            summary["orphan_void"] = extra

        self.stdout.write(self.style.SUCCESS(str(summary)))
