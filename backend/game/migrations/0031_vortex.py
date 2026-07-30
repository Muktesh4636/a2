# Generated manually for Vortex (JWT + Wallet)

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("game", "0030_chicken_road"),
    ]

    operations = [
        migrations.CreateModel(
            name="VortexSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("bet", models.PositiveIntegerField(default=10)),
                ("water", models.PositiveSmallIntegerField(default=0)),
                ("earth", models.PositiveSmallIntegerField(default=0)),
                ("fire", models.PositiveSmallIntegerField(default=0)),
                ("busy", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="vortex_session",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
    ]
