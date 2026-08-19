import uuid

from django.conf import settings
from django.db import models


class GameSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bankroll = models.PositiveIntegerField(default=settings.STARTING_BANKROLL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Session {self.id} · ₹{self.bankroll}"


class Round(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RESOLVED = "resolved", "Resolved"

    class Action(models.TextChoices):
        NONE = "", "None"
        PLAY = "play", "Play"
        FOLD = "fold", "Fold"

    class Outcome(models.TextChoices):
        NONE = "", "None"
        FOLD = "fold", "Fold"
        DEALER_NQ = "dealer_nq", "Dealer not qualified"
        PLAYER_WIN = "player_win", "Player win"
        DEALER_WIN = "dealer_win", "Dealer win"
        TIE = "tie", "Tie"

    session = models.ForeignKey(
        GameSession, on_delete=models.CASCADE, related_name="rounds"
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    ante = models.PositiveIntegerField()
    play_chip = models.PositiveIntegerField(default=0)
    action = models.CharField(
        max_length=8, choices=Action.choices, blank=True, default=""
    )

    p1_label = models.CharField(max_length=2)
    p1_value = models.PositiveSmallIntegerField()
    p1_symbol = models.CharField(max_length=2)
    p1_red = models.BooleanField(default=False)
    p2_label = models.CharField(max_length=2)
    p2_value = models.PositiveSmallIntegerField()
    p2_symbol = models.CharField(max_length=2)
    p2_red = models.BooleanField(default=False)
    p3_label = models.CharField(max_length=2)
    p3_value = models.PositiveSmallIntegerField()
    p3_symbol = models.CharField(max_length=2)
    p3_red = models.BooleanField(default=False)

    d1_label = models.CharField(max_length=2)
    d1_value = models.PositiveSmallIntegerField()
    d1_symbol = models.CharField(max_length=2)
    d1_red = models.BooleanField(default=False)
    d2_label = models.CharField(max_length=2)
    d2_value = models.PositiveSmallIntegerField()
    d2_symbol = models.CharField(max_length=2)
    d2_red = models.BooleanField(default=False)
    d3_label = models.CharField(max_length=2)
    d3_value = models.PositiveSmallIntegerField()
    d3_symbol = models.CharField(max_length=2)
    d3_red = models.BooleanField(default=False)

    player_hand = models.CharField(max_length=20, blank=True, default="")
    dealer_hand = models.CharField(max_length=20, blank=True, default="")
    dealer_qualified = models.BooleanField(default=False)
    outcome = models.CharField(
        max_length=12, choices=Outcome.choices, blank=True, default=""
    )
    won = models.BooleanField(default=False)
    payout = models.PositiveIntegerField(default=0)
    bankroll_after = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Round {self.id} · ante ₹{self.ante} · {self.status}"

    def player_card_dicts(self) -> list[dict]:
        return [
            {
                "label": self.p1_label,
                "value": self.p1_value,
                "symbol": self.p1_symbol,
                "red": self.p1_red,
            },
            {
                "label": self.p2_label,
                "value": self.p2_value,
                "symbol": self.p2_symbol,
                "red": self.p2_red,
            },
            {
                "label": self.p3_label,
                "value": self.p3_value,
                "symbol": self.p3_symbol,
                "red": self.p3_red,
            },
        ]

    def dealer_card_dicts(self) -> list[dict]:
        return [
            {
                "label": self.d1_label,
                "value": self.d1_value,
                "symbol": self.d1_symbol,
                "red": self.d1_red,
            },
            {
                "label": self.d2_label,
                "value": self.d2_value,
                "symbol": self.d2_symbol,
                "red": self.d2_red,
            },
            {
                "label": self.d3_label,
                "value": self.d3_value,
                "symbol": self.d3_symbol,
                "red": self.d3_red,
            },
        ]
