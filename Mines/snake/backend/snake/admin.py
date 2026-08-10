from django.contrib import admin

from .models import Game, Player


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ('id', 'balance', 'created_at')


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'player',
        'bet_amount',
        'die1',
        'die2',
        'dice_sum',
        'land_index',
        'status',
        'multiplier',
        'payout',
    )
    list_filter = ('status',)
