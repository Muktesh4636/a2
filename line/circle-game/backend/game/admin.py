from django.contrib import admin

from .models import Player, Spin


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ('id', 'balance', 'created_at', 'updated_at')
    readonly_fields = ('id', 'created_at', 'updated_at')


@admin.register(Spin)
class SpinAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'player',
        'bet_amount',
        'segment_id',
        'multiplier',
        'payout',
        'balance_after',
        'created_at',
    )
    list_filter = ('segment_id', 'multiplier')
    readonly_fields = ('id', 'created_at')
    raw_id_fields = ('player',)
