import django.db.models.deletion
from django.db import migrations, models


def migrate_staff_roles(apps, schema_editor):
    User = apps.get_model('accounts', 'User')
    for user in User.objects.all().iterator():
        if user.is_superuser:
            user.staff_role = 'SUPER_ADMIN'
            user.save(update_fields=['staff_role'])
        elif user.is_staff and getattr(user, 'is_franchise_only', False):
            user.staff_role = 'ADMIN'
            user.save(update_fields=['staff_role'])
        elif user.is_staff:
            # Former workers → Agents; deactivate orphans without parent Admin
            user.staff_role = 'AGENT'
            if not user.works_under_id:
                user.is_active = False
                user.save(update_fields=['staff_role', 'is_active'])
            else:
                user.save(update_fields=['staff_role'])
        else:
            if getattr(user, 'staff_role', None) != 'PLAYER':
                user.staff_role = 'PLAYER'
                user.save(update_fields=['staff_role'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0049_client_event'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='staff_role',
            field=models.CharField(
                choices=[
                    ('PLAYER', 'Player'),
                    ('SUPER_ADMIN', 'Super Admin'),
                    ('ADMIN', 'Admin'),
                    ('AGENT', 'Agent'),
                ],
                db_index=True,
                default='PLAYER',
                help_text='Hierarchy role: PLAYER, SUPER_ADMIN, ADMIN (franchise), or AGENT.',
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='user',
            name='worker',
            field=models.ForeignKey(
                blank=True,
                help_text='For players: ownership parent (Super Admin, Admin, or Agent) for deposit/withdraw scoping.',
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
                help_text='For Agents: the Admin under whom this Agent joined.',
                limit_choices_to={'is_staff': True},
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='assigned_workers',
                to='accounts.user',
            ),
        ),
        migrations.RunPython(migrate_staff_roles, noop_reverse),
    ]
