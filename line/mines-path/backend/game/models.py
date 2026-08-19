from uuid import uuid4
from django.db import models


class Player(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=1000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Round(models.Model):
    STATUS = (('active', 'Active'), ('bust', 'Bust'), ('cashed', 'Cashed'))
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name='rounds')
    bet_amount = models.DecimalField(max_digits=12, decimal_places=2)
    mines_json = models.TextField()
    revealed_json = models.TextField(default='[]')
    safe_count = models.PositiveSmallIntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
