# Generated manually for trading game (JWT + Wallet)

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("game", "0028_roulette"),
    ]

    operations = [
        migrations.CreateModel(
            name="TradingPendingBet",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("side", models.CharField(choices=[("up", "Up"), ("down", "Down")], max_length=4)),
                ("stake", models.PositiveIntegerField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="trading_pending_bets",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["id"]},
        ),
        migrations.CreateModel(
            name="TradingUndoEntry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("chip", models.PositiveIntegerField()),
                ("side", models.CharField(max_length=4)),
                ("action", models.CharField(default="add", max_length=8)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="trading_undo_stack",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["id"]},
        ),
        migrations.CreateModel(
            name="TradingRound",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("shared_round", models.PositiveIntegerField(default=0)),
                ("final_pct", models.FloatField()),
                ("side", models.CharField(blank=True, default="", max_length=4)),
                ("stake", models.PositiveIntegerField(default=0)),
                ("payout", models.PositiveIntegerField(default=0)),
                ("cashed_out", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="trading_rounds",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddConstraint(
            model_name="tradingpendingbet",
            constraint=models.UniqueConstraint(fields=("user",), name="uniq_trading_pending_per_user"),
        ),
    ]
