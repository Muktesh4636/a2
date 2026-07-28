from rest_framework import serializers
from django.contrib.auth.models import User
from .models import Wallet, Round, Bet, Transaction


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'password')

    def create(self, validated_data):
        user = User.objects.create_user(**validated_data)
        Wallet.objects.create(user=user)
        return user


class WalletSerializer(serializers.ModelSerializer):
    class Meta:
        model = Wallet
        fields = ('balance', 'updated_at')


class UserSerializer(serializers.ModelSerializer):
    wallet = WalletSerializer(read_only=True)

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'wallet')


class RoundSerializer(serializers.ModelSerializer):
    class Meta:
        model = Round
        fields = (
            'id', 'phase', 'final_pct', 'started_at',
            'phase_ends_at', 'settled_at',
            'up_amount', 'down_amount', 'up_players', 'down_players',
        )


class BetSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    round_id = serializers.IntegerField(source='round.id', read_only=True)

    class Meta:
        model = Bet
        fields = (
            'id', 'username', 'round_id', 'side', 'stake',
            'payout', 'won', 'cashed_out', 'cashout_pct', 'cashout_payout',
            'placed_at',
        )
        read_only_fields = (
            'id', 'username', 'round_id', 'payout', 'won',
            'cashed_out', 'cashout_pct', 'cashout_payout', 'placed_at',
        )


class PlaceBetSerializer(serializers.Serializer):
    side = serializers.ChoiceField(choices=['up', 'down'])
    stake = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=1)


class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ('id', 'kind', 'amount', 'balance_after', 'round_id', 'created_at', 'note')
