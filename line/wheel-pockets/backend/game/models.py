from uuid import uuid4
from django.db import models

class Player(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=1000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class Play(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name='plays')
    bet_amount = models.DecimalField(max_digits=12, decimal_places=2)
    pocket_id = models.CharField(max_length=16)
    multiplier = models.DecimalField(max_digits=8, decimal_places=2)
    payout = models.DecimalField(max_digits=12, decimal_places=2)
    target_angle = models.FloatField()
    balance_after = models.DecimalField(max_digits=12, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
