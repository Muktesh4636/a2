from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('game', '0027_cricketoutcomeresult'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='RouletteRound',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('winning_number', models.PositiveSmallIntegerField()),
                ('total_stake', models.PositiveIntegerField(default=0)),
                ('total_payout', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='roulette_rounds', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='RoulettePendingBet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('bet_type', models.CharField(choices=[('straight', 'Straight'), ('red', 'Red'), ('black', 'Black'), ('even', 'Even'), ('odd', 'Odd'), ('low', '1-18'), ('high', '19-36'), ('dozen', 'Dozen'), ('column', 'Column')], max_length=16)),
                ('bet_value', models.CharField(blank=True, default='', max_length=8)),
                ('amount', models.PositiveIntegerField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='roulette_pending_bets', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['id']},
        ),
        migrations.CreateModel(
            name='RouletteUndoEntry',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('bet_type', models.CharField(choices=[('straight', 'Straight'), ('red', 'Red'), ('black', 'Black'), ('even', 'Even'), ('odd', 'Odd'), ('low', '1-18'), ('high', '19-36'), ('dozen', 'Dozen'), ('column', 'Column')], max_length=16)),
                ('bet_value', models.CharField(blank=True, default='', max_length=8)),
                ('chip', models.PositiveIntegerField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='roulette_undo_stack', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['id']},
        ),
        migrations.CreateModel(
            name='RouletteSettledBet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('bet_type', models.CharField(choices=[('straight', 'Straight'), ('red', 'Red'), ('black', 'Black'), ('even', 'Even'), ('odd', 'Odd'), ('low', '1-18'), ('high', '19-36'), ('dozen', 'Dozen'), ('column', 'Column')], max_length=16)),
                ('bet_value', models.CharField(blank=True, default='', max_length=8)),
                ('amount', models.PositiveIntegerField()),
                ('won', models.BooleanField(default=False)),
                ('payout', models.PositiveIntegerField(default=0)),
                ('round', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='bets', to='game.rouletteround')),
            ],
            options={'ordering': ['id']},
        ),
        migrations.AddConstraint(
            model_name='roulettependingbet',
            constraint=models.UniqueConstraint(fields=('user', 'bet_type', 'bet_value'), name='uniq_roulette_pending_bet_key'),
        ),
    ]
