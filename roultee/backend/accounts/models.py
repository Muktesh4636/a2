import uuid

from django.conf import settings
from django.db import models


class Player(models.Model):
    """Guest player identified by a session token."""

    session_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    balance = models.PositiveIntegerField(default=settings.STARTING_BALANCE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Player {self.session_key} (₹{self.balance})"
