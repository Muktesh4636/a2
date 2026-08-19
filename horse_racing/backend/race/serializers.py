from rest_framework import serializers

from .models import Bet, Horse, Race, RaceEntry
from decimal import Decimal


class HorseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Horse
        fields = [
            "id",
            "number",
            "name",
            "silk_color",
            "cloth_color",
            "coat_color",
            "mane_color",
            "fur_map",
            "is_active",
        ]


class RaceEntrySerializer(serializers.ModelSerializer):
    horse = HorseSerializer(read_only=True)
    horse_id = serializers.PrimaryKeyRelatedField(
        queryset=Horse.objects.all(),
        source="horse",
        write_only=True,
        required=False,
    )
    horse_number = serializers.IntegerField(write_only=True, required=False)

    class Meta:
        model = RaceEntry
        fields = [
            "id",
            "horse",
            "horse_id",
            "horse_number",
            "lane",
            "finish_position",
            "finish_time_seconds",
            "laps_completed",
        ]


class BetSerializer(serializers.ModelSerializer):
    horse = HorseSerializer(read_only=True)
    horse_name = serializers.CharField(source="horse.name", read_only=True)

    class Meta:
        model = Bet
        fields = [
            "id",
            "race",
            "horse",
            "horse_name",
            "amount",
            "odds",
            "status",
            "payout",
            "created_at",
        ]
        read_only_fields = ["status", "payout", "created_at", "race"]


class PlaceBetSerializer(serializers.Serializer):
    horse_number = serializers.IntegerField(min_value=1)
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal("1")
    )
    odds = serializers.DecimalField(
        max_digits=6, decimal_places=2, min_value=Decimal("1.01")
    )


class RaceSerializer(serializers.ModelSerializer):
    entries = RaceEntrySerializer(many=True, read_only=True)
    bets = BetSerializer(many=True, read_only=True)
    winner_name = serializers.CharField(source="winner.name", read_only=True, default=None)

    class Meta:
        model = Race
        fields = [
            "id",
            "status",
            "total_laps",
            "started_at",
            "finished_at",
            "duration_seconds",
            "winner",
            "winner_name",
            "entries",
            "bets",
            "created_at",
        ]
        read_only_fields = [
            "status",
            "started_at",
            "finished_at",
            "duration_seconds",
            "winner",
            "created_at",
        ]


class FinishRaceSerializer(serializers.Serializer):
    duration_seconds = serializers.FloatField(min_value=0)
    winner_number = serializers.IntegerField(min_value=1, required=False)
    winner_name = serializers.CharField(max_length=64, required=False)
    results = serializers.ListField(
        child=serializers.DictField(),
        allow_empty=False,
    )

    def validate_results(self, value):
        for item in value:
            if "horse_number" not in item and "name" not in item:
                raise serializers.ValidationError(
                    "Each result needs horse_number or name."
                )
            if "finish_position" not in item:
                raise serializers.ValidationError(
                    "Each result needs finish_position."
                )
        return value


class LeaderboardEntrySerializer(serializers.Serializer):
    race_id = serializers.IntegerField()
    winner_name = serializers.CharField()
    duration_seconds = serializers.FloatField()
    finished_at = serializers.DateTimeField()
