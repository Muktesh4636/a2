from django.contrib import admin

from .models import Game, Player


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ('id', 'balance', 'created_at', 'updated_at')
    readonly_fields = ('id', 'created_at', 'updated_at')


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'player',
        'bet_amount',
        'multiplier',
        'payout',
        'profit',
        'win_index',
        'status',
        'created_at',
    )
    list_filter = ('status',)
    readonly_fields = ('id', 'created_at', 'finished_at')
