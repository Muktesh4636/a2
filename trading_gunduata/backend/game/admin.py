from django.contrib import admin
from .models import Wallet, Round, Bet, Transaction


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ('user', 'balance', 'updated_at')
    search_fields = ('user__username',)


@admin.register(Round)
class RoundAdmin(admin.ModelAdmin):
    list_display = ('id', 'phase', 'final_pct', 'started_at', 'settled_at')
    list_filter = ('phase',)
    actions = ['mark_trading', 'mark_settled']

    @admin.action(description='Set phase → trading')
    def mark_trading(self, request, qs):
        from django.utils import timezone
        from datetime import timedelta
        for rnd in qs:
            rnd.phase = 'trading'
            rnd.phase_ends_at = timezone.now() + timedelta(seconds=10)
            rnd.save()

    @admin.action(description='Set phase → settled (final_pct=0)')
    def mark_settled(self, request, qs):
        from django.utils import timezone
        for rnd in qs:
            rnd.phase = 'settled'
            rnd.final_pct = rnd.final_pct or 0
            rnd.settled_at = timezone.now()
            rnd.save()


@admin.register(Bet)
class BetAdmin(admin.ModelAdmin):
    list_display = ('user', 'round', 'side', 'stake', 'won', 'payout', 'cashed_out')
    list_filter = ('side', 'won', 'cashed_out')
    search_fields = ('user__username',)


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ('user', 'kind', 'amount', 'balance_after', 'created_at')
    list_filter = ('kind',)
    search_fields = ('user__username',)
