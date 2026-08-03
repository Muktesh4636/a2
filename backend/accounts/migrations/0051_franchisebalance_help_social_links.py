from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Sync Django state with help_* social columns already present on some DBs
    (from historical 0048_franchise_help_social_links). Safe on fresh DBs too.
    """

    dependencies = [
        ('accounts', '0050_user_staff_role'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name='franchisebalance',
                    name='help_facebook',
                    field=models.CharField(
                        blank=True,
                        default='',
                        help_text="Help Center Facebook URL/handle for this franchise's APK.",
                        max_length=500,
                    ),
                ),
                migrations.AddField(
                    model_name='franchisebalance',
                    name='help_instagram',
                    field=models.CharField(
                        blank=True,
                        default='',
                        help_text="Help Center Instagram URL/handle for this franchise's APK.",
                        max_length=500,
                    ),
                ),
                migrations.AddField(
                    model_name='franchisebalance',
                    name='help_youtube',
                    field=models.CharField(
                        blank=True,
                        default='',
                        help_text="Help Center YouTube URL/handle for this franchise's APK.",
                        max_length=500,
                    ),
                ),
            ],
            database_operations=[
                migrations.RunSQL(
                    sql="""
                    ALTER TABLE accounts_franchisebalance
                        ADD COLUMN IF NOT EXISTS help_facebook varchar(500) DEFAULT '' NOT NULL;
                    ALTER TABLE accounts_franchisebalance
                        ADD COLUMN IF NOT EXISTS help_instagram varchar(500) DEFAULT '' NOT NULL;
                    ALTER TABLE accounts_franchisebalance
                        ADD COLUMN IF NOT EXISTS help_youtube varchar(500) DEFAULT '' NOT NULL;
                    UPDATE accounts_franchisebalance SET help_facebook = '' WHERE help_facebook IS NULL;
                    UPDATE accounts_franchisebalance SET help_instagram = '' WHERE help_instagram IS NULL;
                    UPDATE accounts_franchisebalance SET help_youtube = '' WHERE help_youtube IS NULL;
                    """,
                    reverse_sql=migrations.RunSQL.noop,
                ),
            ],
        ),
    ]
