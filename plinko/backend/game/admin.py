from django.contrib import admin

from .models import Bet, Player


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ("id", "display_name", "token", "balance", "created_at")
    search_fields = ("token", "display_name")
    readonly_fields = ("id", "token", "created_at", "updated_at")


@admin.register(Bet)
class BetAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "player",
        "amount",
        "risk",
        "rows",
        "multiplier",
        "payout",
        "profit",
        "created_at",
    )
    list_filter = ("risk", "rows")
    search_fields = ("player__token",)
    readonly_fields = ("id", "created_at")
