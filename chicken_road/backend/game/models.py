import uuid
from decimal import Decimal

from django.db import models


class Player(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    balance = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('1000.00'),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Player {self.id} ({self.balance})'


class GameRound(models.Model):
    class Difficulty(models.TextChoices):
        EASY = 'easy', 'Easy'
        MEDIUM = 'medium', 'Medium'
        HARD = 'hard', 'Hard'
        HARDCORE = 'hardcore', 'Hardcore'

    class Status(models.TextChoices):
        PLAYING = 'playing', 'Playing'
        CASHED_OUT = 'cashed_out', 'Cashed Out'
        BURNED = 'burned', 'Burned'
        WON = 'won', 'Won'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name='rounds')
    difficulty = models.CharField(max_length=16, choices=Difficulty.choices)
    bet = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PLAYING,
    )
    step = models.PositiveSmallIntegerField(default=0)
    # Full road kept server-side only: [{safe, mult, revealed}, ...]
    road_secret = models.JSONField(default=list)
    payout = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Round {self.id} ({self.status})'
