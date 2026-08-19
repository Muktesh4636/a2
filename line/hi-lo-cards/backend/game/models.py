from uuid import uuid4
from django.db import models


class Player(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=1000)
    best_streak_mult = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_wins = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Round(models.Model):
    STATUS = (('active', 'active'), ('bust', 'bust'), ('cashed', 'cashed'))
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name='rounds')
    bet_amount = models.DecimalField(max_digits=12, decimal_places=2)
    card_rank = models.PositiveSmallIntegerField()
    card_suit = models.CharField(max_length=1)
    streak = models.PositiveSmallIntegerField(default=0)
    auto_cashout = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=8, choices=STATUS, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
