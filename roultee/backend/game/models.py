from django.db import models

from accounts.models import Player


class BetType(models.TextChoices):
    STRAIGHT = "straight", "Straight"
    RED = "red", "Red"
    BLACK = "black", "Black"
    EVEN = "even", "Even"
    ODD = "odd", "Odd"
    LOW = "low", "1-18"
    HIGH = "high", "19-36"
    DOZEN = "dozen", "Dozen"
    COLUMN = "column", "Column"


class PendingBet(models.Model):
    """Open bet on the table before a spin is settled."""

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="pending_bets")
    bet_type = models.CharField(max_length=16, choices=BetType.choices)
    bet_value = models.CharField(
        max_length=8,
        help_text="Number (0-36), dozen/column index (1-3), or empty for even-money bets.",
    )
    amount = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["player", "bet_type", "bet_value"],
                name="uniq_pending_bet_key",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.bet_key} ₹{self.amount}"

    @property
    def bet_key(self) -> str:
        if self.bet_value:
            return f"{self.bet_type}:{self.bet_value}"
        return self.bet_type


class UndoEntry(models.Model):
    """Stack entry for undoing the last chip placement / double."""

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="undo_stack")
    bet_type = models.CharField(max_length=16, choices=BetType.choices)
    bet_value = models.CharField(max_length=8, blank=True, default="")
    chip = models.PositiveIntegerField()
    visual_chip = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    @property
    def bet_key(self) -> str:
        if self.bet_value:
            return f"{self.bet_type}:{self.bet_value}"
        return self.bet_type


class Round(models.Model):
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="rounds")
    winning_number = models.PositiveSmallIntegerField()
    total_stake = models.PositiveIntegerField(default=0)
    total_payout = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Round #{self.pk} → {self.winning_number} (payout ₹{self.total_payout})"


class SettledBet(models.Model):
    """Snapshot of a bet after a round settles."""

    round = models.ForeignKey(Round, on_delete=models.CASCADE, related_name="bets")
    bet_type = models.CharField(max_length=16, choices=BetType.choices)
    bet_value = models.CharField(max_length=8, blank=True, default="")
    amount = models.PositiveIntegerField()
    won = models.BooleanField(default=False)
    payout = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["id"]
