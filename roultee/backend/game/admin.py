from django.contrib import admin

from .models import PendingBet, Round, SettledBet, UndoEntry


class SettledBetInline(admin.TabularInline):
    model = SettledBet
    extra = 0
    readonly_fields = ("bet_type", "bet_value", "amount", "won", "payout")


@admin.register(Round)
class RoundAdmin(admin.ModelAdmin):
    list_display = ("id", "player", "winning_number", "total_stake", "total_payout", "created_at")
    list_filter = ("winning_number",)
    inlines = [SettledBetInline]


@admin.register(PendingBet)
class PendingBetAdmin(admin.ModelAdmin):
    list_display = ("player", "bet_type", "bet_value", "amount", "created_at")
    list_filter = ("bet_type",)


@admin.register(UndoEntry)
class UndoEntryAdmin(admin.ModelAdmin):
    list_display = ("player", "bet_type", "bet_value", "chip", "created_at")
