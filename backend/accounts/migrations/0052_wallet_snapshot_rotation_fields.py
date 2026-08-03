from django.db import migrations, models


class Migration(migrations.Migration):
    """Sync Wallet snapshot/rotation columns that already exist on some DBs."""

    dependencies = [
        ('accounts', '0051_franchisebalance_help_social_links'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name='wallet',
                    name='total_deposits_at_last_withdraw',
                    field=models.BigIntegerField(default=0),
                ),
                migrations.AddField(
                    model_name='wallet',
                    name='turnover_at_last_withdraw',
                    field=models.BigIntegerField(default=0),
                ),
                migrations.AddField(
                    model_name='wallet',
                    name='deposit_rotation_lock',
                    field=models.BigIntegerField(default=0),
                ),
                migrations.AddField(
                    model_name='wallet',
                    name='deposit_rotation_baseline_turnover',
                    field=models.BigIntegerField(default=0),
                ),
            ],
            database_operations=[
                migrations.RunSQL(
                    sql="""
                    ALTER TABLE accounts_wallet
                        ADD COLUMN IF NOT EXISTS total_deposits_at_last_withdraw bigint DEFAULT 0 NOT NULL;
                    ALTER TABLE accounts_wallet
                        ADD COLUMN IF NOT EXISTS turnover_at_last_withdraw bigint DEFAULT 0 NOT NULL;
                    ALTER TABLE accounts_wallet
                        ADD COLUMN IF NOT EXISTS deposit_rotation_lock bigint DEFAULT 0 NOT NULL;
                    ALTER TABLE accounts_wallet
                        ADD COLUMN IF NOT EXISTS deposit_rotation_baseline_turnover bigint DEFAULT 0 NOT NULL;
                    UPDATE accounts_wallet SET total_deposits_at_last_withdraw = 0 WHERE total_deposits_at_last_withdraw IS NULL;
                    UPDATE accounts_wallet SET turnover_at_last_withdraw = 0 WHERE turnover_at_last_withdraw IS NULL;
                    UPDATE accounts_wallet SET deposit_rotation_lock = 0 WHERE deposit_rotation_lock IS NULL;
                    UPDATE accounts_wallet SET deposit_rotation_baseline_turnover = 0 WHERE deposit_rotation_baseline_turnover IS NULL;
                    """,
                    reverse_sql=migrations.RunSQL.noop,
                ),
            ],
        ),
    ]
