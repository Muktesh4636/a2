from django.db import models
from django.utils import timezone


class Player(models.Model):
    """Guest player identified by a browser token."""

    token = models.CharField(max_length=64, unique=True, db_index=True)
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=1000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    cooldown_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"Player {self.pk} ({self.balance})"

    @property
    def cooldown_remaining_ms(self) -> int:
        if not self.cooldown_until:
            return 0
        delta = (self.cooldown_until - timezone.now()).total_seconds()
        return max(0, int(delta * 1000))


class Round(models.Model):
    class Status(models.TextChoices):
        PLAYING = "playing", "Playing"
        CASHED = "cashed", "Cashed out"
        CRASHED = "crashed", "Crashed"

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="rounds")
    bet = models.DecimalField(max_digits=12, decimal_places=2)
    # Secret until the round ends — never expose while playing
    crash_at = models.FloatField()
    pumps = models.PositiveIntegerField(default=0)
    multiplier = models.FloatField(default=1.0)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PLAYING
    )
    payout = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Round {self.pk} {self.status} @{self.multiplier:.2f}x"
