from django.contrib import admin

from .models import Player, Round


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ("id", "token", "balance", "cooldown_until", "updated_at")
    search_fields = ("token",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(Round)
class RoundAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "player",
        "bet",
        "status",
        "pumps",
        "multiplier",
        "crash_at",
        "payout",
        "created_at",
    )
    list_filter = ("status",)
    search_fields = ("player__token",)
    readonly_fields = ("created_at", "ended_at")
