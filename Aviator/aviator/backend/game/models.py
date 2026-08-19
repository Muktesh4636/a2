from __future__ import annotations

import secrets
import uuid
from decimal import Decimal

from django.db import models


class Player(models.Model):
    """Demo player identified by a client-side token (localStorage)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.CharField(max_length=64, unique=True, db_index=True)
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('5000.00'))
    currency = models.CharField(max_length=8, default='INR')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f'{self.token[:8]}… ({self.balance} {self.currency})'


class GameRound(models.Model):
    class Status(models.TextChoices):
        WAITING = 'waiting', 'Waiting'
        FLYING = 'flying', 'Flying'
        CRASHED = 'crashed', 'Crashed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.WAITING)
    crash_point = models.DecimalField(max_digits=10, decimal_places=2)
    seed = models.CharField(max_length=64, default='')
    wait_ms = models.PositiveIntegerField(default=5000)
    growth = models.FloatField(default=0.06)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    crashed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.status} @ {self.crash_point}x'

    @staticmethod
    def sample_crash_point() -> Decimal:
        """Classic crash sampling with ~3% house edge."""
        r = secrets.randbelow(1_000_000) / 1_000_000
        e = 0.97
        raw = int((100 * e) / max(1e-12, 1 - r)) / 100
        return Decimal(str(max(1.0, min(raw, 999.99))))


class Bet(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACTIVE = 'active', 'Active'
        CASHED = 'cashed', 'Cashed'
        LOST = 'lost', 'Lost'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name='bets')
    round = models.ForeignKey(GameRound, on_delete=models.CASCADE, related_name='bets')
    panel = models.PositiveSmallIntegerField(default=0)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    cashout_mult = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    win = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    auto_cashout = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['player', 'round', 'panel']),
        ]

    def __str__(self) -> str:
        return f'panel {self.panel} {self.amount} ({self.status})'
