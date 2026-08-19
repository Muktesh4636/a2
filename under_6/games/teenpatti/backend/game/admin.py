from django.contrib import admin

from .models import GameSession, Round


@admin.register(GameSession)
class GameSessionAdmin(admin.ModelAdmin):
    list_display = ("id", "bankroll", "created_at", "updated_at")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Round)
class RoundAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "session",
        "status",
        "ante",
        "action",
        "player_hand",
        "dealer_hand",
        "outcome",
        "won",
        "payout",
        "created_at",
    )
    list_filter = ("status", "action", "outcome", "won")
    readonly_fields = ("created_at",)
