from django.contrib import admin

from .models import Player, Spin


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ('id', 'balance', 'updated_at', 'created_at')
    readonly_fields = ('id', 'created_at', 'updated_at')


@admin.register(Spin)
class SpinAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'game_id',
        'player',
        'bet_amount',
        'payout',
        'used_free_spin',
        'balance_after',
        'created_at',
    )
    list_filter = ('game_id', 'used_free_spin')
    search_fields = ('id', 'player__id', 'game_id')
    readonly_fields = ('id', 'created_at')
