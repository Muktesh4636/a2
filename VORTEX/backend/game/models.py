from django.db import models


class GameSession(models.Model):
    """Persistent round state keyed by Django session."""

    session_key = models.CharField(max_length=64, unique=True, db_index=True)
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=1000)
    bet = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    water = models.PositiveSmallIntegerField(default=0)
    earth = models.PositiveSmallIntegerField(default=0)
    fire = models.PositiveSmallIntegerField(default=0)
    busy = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.session_key[:8]} bal={self.balance}"
