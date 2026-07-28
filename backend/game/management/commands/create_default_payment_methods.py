from django.core.management.base import BaseCommand
from accounts.models import PaymentMethod


class Command(BaseCommand):
    help = 'Create default payment methods'

    def handle(self, *args, **options):
        default_methods = [
            {
                'name': 'Bank Transfer',
                'method_type': 'BANK',
                'is_active': True,
            },
            {
                'name': 'Google Pay',
                'method_type': 'GPAY',
                'is_active': True,
            },
            {
                'name': 'PhonePe',
                'method_type': 'PHONEPE',
                'is_active': True,
            },
            {
                'name': 'Paytm',
                'method_type': 'PAYTM',
                'is_active': True,
            },
            {
                'name': 'UPI',
                'method_type': 'UPI_QR',
                'is_active': True,
            },
        ]

        created_count = 0
        for method_data in default_methods:
            method, created = PaymentMethod.objects.get_or_create(
                name=method_data['name'],
                defaults=method_data
            )
            if created:
                created_count += 1
                self.stdout.write(
                    self.style.SUCCESS(f'Created: {method.name} ({method.get_method_type_display()})')
                )
            else:
                self.stdout.write(
                    f'Already exists: {method.name} ({method.get_method_type_display()})'
                )

        if created_count > 0:
            self.stdout.write(
                self.style.SUCCESS(f'\n✅ Created {created_count} new default payment methods')
            )
        else:
            self.stdout.write(
                self.style.SUCCESS('\n✅ All default payment methods already exist')
            )