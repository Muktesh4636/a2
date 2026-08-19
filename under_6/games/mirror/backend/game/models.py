import uuid

from django.db import models
from django.conf import settings


class GameSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bankroll = models.PositiveIntegerField(default=settings.STARTING_BANKROLL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Session {self.id} · ₹{self.bankroll}"


class Round(models.Model):
    class Side(models.TextChoices):
        MIRROR = "mirror", "Mirror"
        CLASH = "clash", "Clash"

    session = models.ForeignKey(
        GameSession, on_delete=models.CASCADE, related_name="rounds"
    )
    bet_side = models.CharField(max_length=8, choices=Side.choices)
    chip = models.PositiveIntegerField()
    card1_label = models.CharField(max_length=2)
    card1_value = models.PositiveSmallIntegerField()
    card1_symbol = models.CharField(max_length=2)
    card1_red = models.BooleanField(default=False)
    card2_label = models.CharField(max_length=2)
    card2_value = models.PositiveSmallIntegerField()
    card2_symbol = models.CharField(max_length=2)
    card2_red = models.BooleanField(default=False)
    sum_value = models.PositiveSmallIntegerField()
    result_side = models.CharField(max_length=8, choices=Side.choices)
    won = models.BooleanField(default=False)
    payout = models.PositiveIntegerField(default=0)
    bankroll_after = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Round {self.id} · {self.bet_side} ₹{self.chip} → {self.result_side}"
