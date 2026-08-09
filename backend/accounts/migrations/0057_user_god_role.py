import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0056_svspaybankaccount_svspaysettlement'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='staff_role',
            field=models.CharField(
                choices=[
                    ('PLAYER', 'Player'),
                    ('GOD', 'God Admin'),
                    ('SUPER_ADMIN', 'Super Admin'),
                    ('ADMIN', 'Admin'),
                    ('AGENT', 'Agent'),
                ],
                db_index=True,
                default='PLAYER',
                help_text='Hierarchy role: GOD, SUPER_ADMIN, ADMIN (franchise), AGENT, or PLAYER.',
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='user',
            name='worker',
            field=models.ForeignKey(
                blank=True,
                help_text=(
                    'For players: ownership parent (Super Admin, Admin, or Agent) '
                    'for deposit/withdraw scoping. Never God.'
                ),
                limit_choices_to={'is_staff': True},
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='clients',
                to='accounts.user',
            ),
        ),
        migrations.AlterField(
            model_name='user',
            name='works_under',
            field=models.ForeignKey(
                blank=True,
                help_text='Staff parent one level up: Agent→Admin, Admin→Super Admin, Super Admin→God.',
                limit_choices_to={'is_staff': True},
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='assigned_workers',
                to='accounts.user',
            ),
        ),
    ]
