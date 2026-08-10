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
    mine_count = models.PositiveSmallIntegerField()
    # Server-only until the round ends
    mine_positions = models.JSONField(default=list)
    revealed = models.JSONField(default=list)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PLAYING,
    )
    triggered_mine = models.IntegerField(null=True, blank=True)
    gems_found = models.PositiveSmallIntegerField(default=0)
    multiplier = models.DecimalField(max_digits=12, decimal_places=4, default=1)
    payout = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    profit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'Game {self.id} ({self.status})'
