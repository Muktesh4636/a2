from django.contrib import admin

from .models import Play, Player


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ('id', 'balance', 'created_at', 'updated_at')
    readonly_fields = ('id', 'created_at', 'updated_at')


@admin.register(Play)
class PlayAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'player',
        'bet_amount',
        'zone_id',
        'multiplier',
        'payout',
        'balance_after',
        'created_at',
    )
    list_filter = ('zone_id', 'multiplier')
    readonly_fields = ('id', 'created_at')
    raw_id_fields = ('player',)
