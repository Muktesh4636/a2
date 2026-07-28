from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


class Wallet(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='wallet')
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=10000.00)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.user.username} – ₹{self.balance}'


class Round(models.Model):
    class Phase(models.TextChoices):
        BETTING = 'betting', 'Betting'
        TRADING = 'trading', 'Trading'
        SETTLED = 'settled', 'Settled'

    phase = models.CharField(max_length=10, choices=Phase.choices, default=Phase.BETTING)
    final_pct = models.FloatField(null=True, blank=True)
    started_at = models.DateTimeField(default=timezone.now)
    phase_ends_at = models.DateTimeField(null=True, blank=True)
    settled_at = models.DateTimeField(null=True, blank=True)

    # Crowd sentiment snapshot at round start
    up_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    down_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    up_players = models.IntegerField(default=0)
    down_players = models.IntegerField(default=0)

    def __str__(self):
        return f'Round #{self.pk} [{self.phase}] {self.final_pct or "—"}%'


class Bet(models.Model):
    class Side(models.TextChoices):
        UP = 'up', 'UP'
        DOWN = 'down', 'DOWN'

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='bets')
    round = models.ForeignKey(Round, on_delete=models.CASCADE, related_name='bets')
    side = models.CharField(max_length=4, choices=Side.choices)
    stake = models.DecimalField(max_digits=12, decimal_places=2)

    # Set when settled
    payout = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    won = models.BooleanField(null=True, blank=True)
    cashed_out = models.BooleanField(default=False)
    cashout_pct = models.FloatField(null=True, blank=True)   # % at which user cashed out
    cashout_payout = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    placed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'round')

    def __str__(self):
        return f'{self.user.username} {self.side} ₹{self.stake} on Round #{self.round_id}'


class Transaction(models.Model):
    class Kind(models.TextChoices):
        DEPOSIT = 'deposit', 'Deposit'
        BET = 'bet', 'Bet placed'
        WIN = 'win', 'Win payout'
        LOSS = 'loss', 'Loss'
        CASHOUT = 'cashout', 'Cash out'
        REFUND = 'refund', 'Refund'

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='transactions')
    kind = models.CharField(max_length=10, choices=Kind.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    balance_after = models.DecimalField(max_digits=12, decimal_places=2)
    round = models.ForeignKey(Round, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    note = models.CharField(max_length=200, blank=True)

    def __str__(self):
        return f'{self.user.username} {self.kind} ₹{self.amount}'
