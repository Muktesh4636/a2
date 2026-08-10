import uuid

from django.db import models


class Player(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=10000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f'Player {self.id} (₹{self.balance})'


class Game(models.Model):
    class Status(models.TextChoices):
        SELECTING = 'selecting', 'Selecting'
        SETTLED = 'settled', 'Settled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name='games')
    bet_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Selected cell indices (0 .. ROWS*COLS-1), length 0–4 while selecting, 4 when settled
    selected = models.JSONField(default=list)
    # Full board multipliers after settle; empty while selecting
    multipliers = models.JSONField(default=list)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.SELECTING,
    )
    total_multiplier = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    payout = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    profit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'Boxes {self.id} ({self.status})'
