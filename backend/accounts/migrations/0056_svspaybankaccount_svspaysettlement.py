from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0055_autodeposittransaction_synced_by'),
    ]

    operations = [
        migrations.CreateModel(
            name='SvsPayBankAccount',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('account_holder', models.CharField(max_length=120)),
                ('account_number', models.CharField(max_length=32)),
                ('ifsc', models.CharField(max_length=16)),
                ('bank_name', models.CharField(blank=True, max_length=120)),
                ('is_primary', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='svs_pay_bank_accounts', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'SVS Pay bank account',
                'verbose_name_plural': 'SVS Pay bank accounts',
                'ordering': ['-is_primary', '-id'],
            },
        ),
        migrations.CreateModel(
            name='SvsPaySettlement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('APPROVED', 'Approved'), ('PAID', 'Paid'), ('REJECTED', 'Rejected')], db_index=True, default='PENDING', max_length=16)),
                ('note', models.CharField(blank=True, max_length=255)),
                ('account_holder', models.CharField(blank=True, max_length=120)),
                ('account_number', models.CharField(blank=True, max_length=32)),
                ('ifsc', models.CharField(blank=True, max_length=16)),
                ('bank_name', models.CharField(blank=True, max_length=120)),
                ('processed_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('bank_account', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='settlements', to='accounts.svspaybankaccount')),
                ('processed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='svs_pay_settlements_processed', to=settings.AUTH_USER_MODEL)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='svs_pay_settlements', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'SVS Pay settlement',
                'verbose_name_plural': 'SVS Pay settlements',
                'ordering': ['-created_at', '-id'],
            },
        ),
    ]
