from django.contrib import admin

from .models import LedgerEntry, Player, Round


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ("id", "token_short", "balance", "created_at", "updated_at")
    search_fields = ("token", "id")
    readonly_fields = ("id", "token", "created_at", "updated_at")

    @admin.display(description="token")
    def token_short(self, obj):
        return f"{obj.token[:12]}…"


@admin.register(Round)
class RoundAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "player",
        "difficulty",
        "bet",
        "step",
        "status",
        "payout",
        "crash_at",
        "created_at",
    )
    list_filter = ("status", "difficulty")
    search_fields = ("id", "player__token")
    readonly_fields = (
        "id",
        "server_seed",
        "server_seed_hash",
        "client_seed",
        "crash_at",
        "created_at",
        "finished_at",
    )


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = ("id", "player", "kind", "amount", "balance_after", "created_at")
    list_filter = ("kind",)
    search_fields = ("player__token", "note")
