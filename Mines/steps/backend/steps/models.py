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
        PLAYING = 'playing', 'Playing'
        LOST = 'lost', 'Lost'
        WON = 'won', 'Won'
        CASHED = 'cashed', 'Cashed Out'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name='games')
    bet_amount = models.DecimalField(max_digits=12, decimal_places=2)
    # Per row: index of the danger column (0–2). Length = STEPS_ROWS.
    danger_columns = models.JSONField(default=list)
    # Chosen column per completed row, bottom → top. Length = steps_cleared.
    path = models.JSONField(default=list)
    current_row = models.PositiveSmallIntegerField(default=0)
    steps_cleared = models.PositiveSmallIntegerField(default=0)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PLAYING,
    )
    triggered_row = models.IntegerField(null=True, blank=True)
    triggered_col = models.IntegerField(null=True, blank=True)
    multiplier = models.DecimalField(max_digits=12, decimal_places=4, default=1)
    payout = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    profit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'Steps {self.id} ({self.status})'
