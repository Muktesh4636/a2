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
        "bet_side",
        "chip",
        "sum_value",
        "result_side",
        "won",
        "payout",
        "created_at",
    )
    list_filter = ("bet_side", "result_side", "won")
    readonly_fields = ("created_at",)
