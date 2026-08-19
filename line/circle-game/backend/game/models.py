from decimal import Decimal
from uuid import uuid4

from django.conf import settings
from django.db import models


class Player(models.Model):
    """Anonymous play session identified by a client-held token."""

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('1000.00'))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'Player {self.id} — ₹{self.balance}'


class Spin(models.Model):
    """One completed bet / wheel spin."""

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name='spins')
    bet_amount = models.DecimalField(max_digits=12, decimal_places=2)
    segment_id = models.CharField(max_length=16)
    multiplier = models.DecimalField(max_digits=6, decimal_places=2)
    payout = models.DecimalField(max_digits=12, decimal_places=2)
    target_angle = models.FloatField(help_text='Absolute wheel angle (deg) under the pointer')
    balance_after = models.DecimalField(max_digits=12, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'Spin {self.segment_id} {self.multiplier}x → ₹{self.payout}'


def default_balance() -> Decimal:
    return Decimal(getattr(settings, 'GAME_INITIAL_BALANCE', '1000.00'))
