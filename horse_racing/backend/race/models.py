from django.db import models


class Horse(models.Model):
    """A racehorse in the field."""

    number = models.PositiveSmallIntegerField(unique=True)
    name = models.CharField(max_length=64)
    silk_color = models.CharField(max_length=7, help_text="Hex color for silks, e.g. #c62828")
    cloth_color = models.CharField(max_length=7)
    coat_color = models.CharField(max_length=7)
    mane_color = models.CharField(max_length=7)
    fur_map = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["number"]

    def __str__(self):
        return self.name


class Race(models.Model):
    """One race session from start to finish."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PARADE = "parade", "Parade"
        READY = "ready", "Ready"
        RACING = "racing", "Racing"
        FINISHED = "finished", "Finished"
        CANCELLED = "cancelled", "Cancelled"

    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    total_laps = models.PositiveSmallIntegerField(default=3)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.FloatField(null=True, blank=True)
    winner = models.ForeignKey(
        Horse,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="wins",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Race #{self.pk} ({self.status})"


class RaceEntry(models.Model):
    """A horse's place and stats in a race."""

    race = models.ForeignKey(Race, on_delete=models.CASCADE, related_name="entries")
    horse = models.ForeignKey(Horse, on_delete=models.CASCADE, related_name="entries")
    lane = models.PositiveSmallIntegerField()
    finish_position = models.PositiveSmallIntegerField(null=True, blank=True)
    finish_time_seconds = models.FloatField(null=True, blank=True)
    laps_completed = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["lane"]
        unique_together = [("race", "horse"), ("race", "lane")]

    def __str__(self):
        return f"{self.horse} in Race #{self.race_id}"


class Bet(models.Model):
    """A stake on a horse to win a race."""

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        WON = "won", "Won"
        LOST = "lost", "Lost"
        VOID = "void", "Void"

    race = models.ForeignKey(Race, on_delete=models.CASCADE, related_name="bets")
    horse = models.ForeignKey(Horse, on_delete=models.CASCADE, related_name="bets")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    odds = models.DecimalField(max_digits=6, decimal_places=2)
    status = models.CharField(
        max_length=8,
        choices=Status.choices,
        default=Status.OPEN,
    )
    payout = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"₹{self.amount} on {self.horse} @ {self.odds}"
