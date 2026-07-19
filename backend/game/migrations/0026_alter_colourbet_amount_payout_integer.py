# ColourBet: use IntegerField instead of BigIntegerField for stake/payout.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('game', '0025_cricketbet_rupees'),
    ]

    operations = [
        migrations.AlterField(
            model_name='colourbet',
            name='amount',
            field=models.IntegerField(),
        ),
        migrations.AlterField(
            model_name='colourbet',
            name='payout',
            field=models.IntegerField(default=0),
        ),
    ]
