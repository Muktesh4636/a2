from rest_framework import serializers

from game.models import GameRound, Player


class PlayerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Player
        fields = ('id', 'balance', 'created_at')
        read_only_fields = fields


class StartGameSerializer(serializers.Serializer):
    bet = serializers.DecimalField(max_digits=12, decimal_places=2)
    difficulty = serializers.ChoiceField(choices=GameRound.Difficulty.choices)
