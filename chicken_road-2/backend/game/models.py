import secrets
import uuid

from django.db import models

from .constants import START_BALANCE


class Player(models.Model):
    """Guest wallet for a browser session (token in X-Player-Token)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.CharField(max_length=64, unique=True, db_index=True)
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=START_BALANCE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Player {self.token[:8]}… ({self.balance})"

    @classmethod
    def create_guest(cls):
        return cls.objects.create(token=secrets.token_hex(32), balance=START_BALANCE)


class Round(models.Model):
    class Difficulty(models.TextChoices):
        EASY = "easy", "Easy"
        MEDIUM = "medium", "Medium"
        HARD = "hard", "Hard"
        HARDCORE = "hardcore", "Hardcore"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        CASHED_OUT = "cashed_out", "Cashed out"
        CRASHED = "crashed", "Crashed"
        COMPLETED = "completed", "Completed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="rounds")
    difficulty = models.CharField(max_length=16, choices=Difficulty.choices)
    bet = models.DecimalField(max_digits=10, decimal_places=2)
    step = models.PositiveIntegerField(default=0)
    # 1-based step where the hen dies; null = clear run to the end
    crash_at = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.ACTIVE, db_index=True
    )
    payout = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    server_seed = models.CharField(max_length=64)
    server_seed_hash = models.CharField(max_length=64)
    client_seed = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Round {self.id} [{self.status}] step={self.step}"


class LedgerEntry(models.Model):
    class Kind(models.TextChoices):
        BET = "bet", "Bet"
        WIN = "win", "Win"
        RESET = "reset", "Reset"
        LOSS = "loss", "Loss"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="ledger")
    round = models.ForeignKey(
        Round, on_delete=models.SET_NULL, null=True, blank=True, related_name="ledger"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    balance_after = models.DecimalField(max_digits=14, decimal_places=2)
    note = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "ledger entries"
