from decimal import Decimal

from rest_framework import serializers

from .models import Bet, Player
from .multipliers import VALID_RISKS, VALID_ROWS, format_multiplier


class PlayerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Player
        fields = ["id", "display_name", "balance", "created_at", "updated_at"]
        read_only_fields = fields


class BetSerializer(serializers.ModelSerializer):
    multiplier_label = serializers.SerializerMethodField()

    class Meta:
        model = Bet
        fields = [
            "id",
            "amount",
            "risk",
            "rows",
            "bucket_index",
            "multiplier",
            "multiplier_label",
            "payout",
            "profit",
            "balance_after",
            "created_at",
        ]
        read_only_fields = fields

    def get_multiplier_label(self, obj):
        return format_multiplier(float(obj.multiplier))


class PlaceBetSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0.01")
    )
    risk = serializers.ChoiceField(choices=sorted(VALID_RISKS))
    rows = serializers.IntegerField()
    # Optional: frontend can report where the ball visually landed.
    # If omitted, server rolls the outcome.
    bucket_index = serializers.IntegerField(required=False, allow_null=True)

    def validate_rows(self, value):
        if value not in VALID_ROWS:
            raise serializers.ValidationError(
                f"rows must be one of {sorted(VALID_ROWS)}"
            )
        return value


class ResetBalanceSerializer(serializers.Serializer):
    balance = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0"),
        required=False,
        default=Decimal("1000"),
    )
