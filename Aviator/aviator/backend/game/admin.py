from django.contrib import admin

from .models import Bet, GameRound, Player


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ('token', 'balance', 'currency', 'created_at')
    search_fields = ('token',)


@admin.register(GameRound)
class GameRoundAdmin(admin.ModelAdmin):
    list_display = ('id', 'status', 'crash_point', 'created_at', 'crashed_at')
    list_filter = ('status',)


@admin.register(Bet)
class BetAdmin(admin.ModelAdmin):
    list_display = ('id', 'player', 'panel', 'amount', 'status', 'cashout_mult', 'win')
    list_filter = ('status',)
