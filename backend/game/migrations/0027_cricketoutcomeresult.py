from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('game', '0026_alter_colourbet_amount_payout_integer'),
    ]

    operations = [
        migrations.CreateModel(
            name='CricketOutcomeResult',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_id', models.BigIntegerField(db_index=True)),
                ('event_name', models.CharField(blank=True, default='', max_length=255)),
                ('market_id', models.BigIntegerField(db_index=True)),
                ('market_name', models.CharField(blank=True, default='', max_length=255)),
                ('market_status', models.CharField(blank=True, default='', max_length=40)),
                ('outcome_id', models.BigIntegerField(db_index=True, unique=True)),
                ('outcome_name', models.CharField(blank=True, default='', max_length=255)),
                ('result_code', models.CharField(
                    choices=[
                        ('NO_RESULT', 'No Result'),
                        ('WIN', 'Win'),
                        ('LOSE', 'Lose'),
                        ('VOID', 'Void'),
                        ('UNKNOWN', 'Unknown'),
                    ],
                    db_index=True,
                    default='NO_RESULT',
                    max_length=20,
                )),
                ('raw_result', models.CharField(blank=True, default='', max_length=40)),
                ('is_final', models.BooleanField(db_index=True, default=False)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'verbose_name': 'Cricket Outcome Result',
                'verbose_name_plural': 'Cricket Outcome Results',
                'ordering': ['-updated_at'],
            },
        ),
        migrations.AddIndex(
            model_name='cricketoutcomeresult',
            index=models.Index(fields=['event_id', 'market_id'], name='game_cricke_event_i_7d0f2a_idx'),
        ),
        migrations.AddIndex(
            model_name='cricketoutcomeresult',
            index=models.Index(fields=['is_final', 'result_code'], name='game_cricke_is_fina_2a8c11_idx'),
        ),
    ]
