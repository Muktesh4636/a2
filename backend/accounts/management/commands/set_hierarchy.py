from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import User
from game.admin_utils import PARENT_ROLE, PLAYER_OWNER_ROLES, role_of, sync_staff_flags


class Command(BaseCommand):
    help = (
        'Assign a hierarchy role to an account. '
        'God > Super Admin > Admin > Agent > Player.'
    )

    def add_arguments(self, parser):
        parser.add_argument('username', help='Account to update')
        parser.add_argument(
            'role',
            choices=['GOD', 'SUPER_ADMIN', 'ADMIN', 'AGENT', 'PLAYER'],
            help='Role to assign',
        )
        parser.add_argument(
            '--parent',
            default=None,
            help='Username of the staff account one level up (required for SUPER_ADMIN/ADMIN/AGENT)',
        )
        parser.add_argument(
            '--owner',
            default=None,
            help='For PLAYER: username of the owning Super Admin, Admin, or Agent',
        )

    def handle(self, *args, **options):
        username = options['username']
        role = options['role']
        parent_name = options['parent']
        owner_name = options['owner']

        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            raise CommandError(f'No such user: {username}')

        parent = None
        if role in PARENT_ROLE:
            if not parent_name:
                raise CommandError(
                    f'{role} requires --parent (a {PARENT_ROLE[role]} account)'
                )
            try:
                parent = User.objects.get(username=parent_name)
            except User.DoesNotExist:
                raise CommandError(f'No such parent user: {parent_name}')
            if parent.pk == user.pk:
                raise CommandError('An account cannot be its own parent')
            expected = PARENT_ROLE[role]
            actual = role_of(parent)
            if actual != expected:
                raise CommandError(
                    f'Parent {parent_name} is {actual}, but {role} must sit under a {expected}'
                )

        owner = None
        if role == 'PLAYER' and owner_name:
            try:
                owner = User.objects.get(username=owner_name)
            except User.DoesNotExist:
                raise CommandError(f'No such owner user: {owner_name}')
            owner_role = role_of(owner)
            if owner_role not in PLAYER_OWNER_ROLES:
                raise CommandError(
                    f'Owner {owner_name} is {owner_role}; players may only sit under '
                    f'{", ".join(PLAYER_OWNER_ROLES)}'
                )

        with transaction.atomic():
            sync_staff_flags(user, role, parent=parent)
            fields = ['staff_role', 'is_staff', 'is_superuser', 'is_franchise_only', 'works_under']
            if role == 'PLAYER' and owner is not None:
                user.worker = owner
                fields.append('worker')
            user.save(update_fields=fields)

        self.stdout.write(
            self.style.SUCCESS(
                f'{user.username} → {role}'
                + (f' under {parent.username}' if parent else '')
                + (f' owned by {owner.username}' if owner else '')
            )
        )
