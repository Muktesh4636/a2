from django.contrib import admin

from game.models import GameRound, Player


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ('id', 'balance', 'created_at', 'updated_at')
    readonly_fields = ('id', 'created_at', 'updated_at')
    search_fields = ('id',)


@admin.register(GameRound)
class GameRoundAdmin(admin.ModelAdmin):
    list_display = ('id', 'player', 'difficulty', 'bet', 'status', 'step', 'payout', 'created_at')
    list_filter = ('status', 'difficulty')
    readonly_fields = ('id', 'road_secret', 'created_at', 'updated_at')
    search_fields = ('id', 'player__id')
