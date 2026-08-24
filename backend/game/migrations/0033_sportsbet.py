from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        ('game', '0032_admin_telegram_link'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='SportsBet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sport', models.CharField(db_index=True, max_length=20)),
                ('event_id', models.BigIntegerField()),
                ('event_name', models.CharField(max_length=255)),
                ('market_id', models.BigIntegerField()),
                ('market_name', models.CharField(max_length=255)),
                ('outcome_id', models.BigIntegerField()),
                ('outcome_name', models.CharField(max_length=255)),
                ('odds', models.DecimalField(decimal_places=2, max_digits=10)),
                ('stake', models.DecimalField(decimal_places=2, help_text='Stake in rupees', max_digits=12)),
                ('potential_payout', models.DecimalField(decimal_places=2, max_digits=12)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('WON', 'Won'), ('LOST', 'Lost'), ('VOID', 'Void')], default='PENDING', max_length=20)),
                ('payout_amount', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('settled_at', models.DateTimeField(blank=True, null=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sports_bets', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Sports Bet',
                'verbose_name_plural': 'Sports Bets',
                'ordering': ['-created_at'],
            },
        ),
    ]
