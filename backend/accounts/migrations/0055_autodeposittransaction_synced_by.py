from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0054_pendingautodeposit'),
    ]

    operations = [
        migrations.AddField(
            model_name='autodeposittransaction',
            name='synced_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='phonepe_synced_transactions',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
