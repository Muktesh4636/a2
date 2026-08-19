from uuid import uuid4
from django.db import models

class Player(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=1000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class Round(models.Model):
    STATUS = (('active', 'Active'), ('cashed', 'Cashed'), ('crashed', 'Crashed'))
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name='rounds')
    bet_amount = models.DecimalField(max_digits=12, decimal_places=2)
    crash_at = models.FloatField()
    cashout_mult = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    payout = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=STATUS, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
