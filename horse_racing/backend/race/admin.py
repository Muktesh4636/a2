from django.contrib import admin

from .models import Bet, Horse, Race, RaceEntry


@admin.register(Horse)
class HorseAdmin(admin.ModelAdmin):
    list_display = ("number", "name", "silk_color", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name",)


class RaceEntryInline(admin.TabularInline):
    model = RaceEntry
    extra = 0
    autocomplete_fields = ("horse",)


class BetInline(admin.TabularInline):
    model = Bet
    extra = 0
    autocomplete_fields = ("horse",)
    readonly_fields = ("status", "payout", "created_at")


@admin.register(Race)
class RaceAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "status",
        "winner",
        "duration_seconds",
        "started_at",
        "finished_at",
    )
    list_filter = ("status",)
    search_fields = ("id", "winner__name")
    inlines = [RaceEntryInline, BetInline]


@admin.register(RaceEntry)
class RaceEntryAdmin(admin.ModelAdmin):
    list_display = (
        "race",
        "horse",
        "lane",
        "finish_position",
        "finish_time_seconds",
    )
    list_filter = ("race",)


@admin.register(Bet)
class BetAdmin(admin.ModelAdmin):
    list_display = ("id", "race", "horse", "amount", "odds", "status", "payout")
    list_filter = ("status",)
    autocomplete_fields = ("horse", "race")
