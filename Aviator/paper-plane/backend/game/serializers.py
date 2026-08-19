from rest_framework import serializers

from .models import Bet, GameRound, Player


class PlayerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Player
        fields = ('id', 'token', 'balance', 'currency')


class RoundSerializer(serializers.ModelSerializer):
    class Meta:
        model = GameRound
        fields = (
            'id',
            'status',
            'crash_point',
            'wait_ms',
            'growth',
            'created_at',
            'started_at',
            'crashed_at',
        )


class BetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bet
        fields = (
            'id',
            'panel',
            'amount',
            'status',
            'cashout_mult',
            'win',
            'auto_cashout',
            'created_at',
        )


class PlaceBetSerializer(serializers.Serializer):
    panel = serializers.IntegerField(min_value=0, max_value=1)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    auto_cashout = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )


class CashOutSerializer(serializers.Serializer):
    panel = serializers.IntegerField(min_value=0, max_value=1)
    mult = serializers.DecimalField(max_digits=10, decimal_places=2)
