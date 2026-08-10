import uuid

from django.db import models


class Player(models.Model):
    """Guest player identified by a client token (no login required)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.CharField(max_length=64, unique=True, db_index=True)
    display_name = models.CharField(max_length=64, blank=True, default="")
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=1000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.display_name or f"Player {self.token[:8]}"


class Bet(models.Model):
    RISK_CHOICES = [
        ("low", "Low"),
        ("medium", "Medium"),
        ("high", "High"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="bets")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    risk = models.CharField(max_length=16, choices=RISK_CHOICES)
    rows = models.PositiveSmallIntegerField()
    bucket_index = models.PositiveSmallIntegerField()
    multiplier = models.DecimalField(max_digits=12, decimal_places=2)
    payout = models.DecimalField(max_digits=14, decimal_places=2)
    profit = models.DecimalField(max_digits=14, decimal_places=2)
    balance_after = models.DecimalField(max_digits=14, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.amount} @ {self.multiplier}x → {self.payout}"
