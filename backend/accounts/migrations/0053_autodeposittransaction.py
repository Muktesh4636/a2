from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0052_wallet_snapshot_rotation_fields'),
    ]

    operations = [
        migrations.CreateModel(
            name='AutoDepositTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('utr', models.CharField(db_index=True, max_length=64, unique=True)),
                ('amount', models.DecimalField(decimal_places=2, help_text='Exact amount received', max_digits=12)),
                ('party_name', models.CharField(blank=True, max_length=255)),
                ('txn_type', models.CharField(blank=True, default='Received from', max_length=64)),
                ('status', models.CharField(choices=[('CREDITED', 'Credited'), ('UNMATCHED', 'Unmatched')], db_index=True, default='CREDITED', max_length=16)),
                ('payment_time', models.DateTimeField(db_index=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('raw_payload', models.JSONField(blank=True, default=dict)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='auto_deposit_transactions', to='accounts.user')),
            ],
            options={
                'ordering': ['-payment_time', '-id'],
            },
        ),
    ]
