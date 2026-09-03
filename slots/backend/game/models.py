from uuid import uuid4

from django.db import models


class Player(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=10000)
    # Per-game feature state: {game_id: {free_spins, pearls}}
    feature_state = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.id} ₹{self.balance}'


class Spin(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name='spins')
    game_id = models.CharField(max_length=64, db_index=True)
    bet_amount = models.DecimalField(max_digits=12, decimal_places=2)
    payout = models.DecimalField(max_digits=14, decimal_places=2)
    used_free_spin = models.BooleanField(default=False)
    grid_json = models.TextField()
    result_json = models.TextField()
    balance_after = models.DecimalField(max_digits=14, decimal_places=2)
    free_spins_after = models.IntegerField(default=0)
    pearls_after = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.game_id} bet={self.bet_amount} pay={self.payout}'
