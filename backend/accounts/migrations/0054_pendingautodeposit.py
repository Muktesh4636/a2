from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0053_autodeposittransaction'),
    ]

    operations = [
        migrations.CreateModel(
            name='PendingAutoDeposit',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('requested_amount', models.BigIntegerField(help_text='Whole-rupee amount credited to wallet on success')),
                ('unique_amount', models.DecimalField(decimal_places=2, help_text='Exact amount the player must pay (for PhonePe matching)', max_digits=12)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('CREDITED', 'Credited'), ('EXPIRED', 'Expired'), ('CANCELLED', 'Cancelled')], db_index=True, default='PENDING', max_length=16)),
                ('utr', models.CharField(blank=True, default='', max_length=64)),
                ('expires_at', models.DateTimeField(db_index=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('credited_at', models.DateTimeField(blank=True, null=True)),
                ('payment_method', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='pending_auto_deposits', to='accounts.paymentmethod')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pending_auto_deposits', to='accounts.user')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='pendingautodeposit',
            index=models.Index(fields=['unique_amount', 'status'], name='accounts_pe_unique__a1b2c3_idx'),
        ),
        migrations.AddIndex(
            model_name='pendingautodeposit',
            index=models.Index(fields=['user', 'status'], name='accounts_pe_user_id_d4e5f6_idx'),
        ),
    ]
