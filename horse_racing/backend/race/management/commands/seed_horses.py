from django.core.management.base import BaseCommand

from race.models import Horse

FIELD = [
    {
        "number": 1,
        "name": "#1 Chestnut",
        "silk_color": "#c62828",
        "cloth_color": "#c62828",
        "coat_color": "#aa5f34",
        "mane_color": "#462a1c",
        "fur_map": "/textures/horses/skins/01-chestnut-fur.jpg?v=3",
    },
    {
        "number": 2,
        "name": "#2 Bay",
        "silk_color": "#1565c0",
        "cloth_color": "#1565c0",
        "coat_color": "#583a28",
        "mane_color": "#120c0a",
        "fur_map": "/textures/horses/skins/02-bay-fur.jpg?v=3",
    },
    {
        "number": 3,
        "name": "#3 Black",
        "silk_color": "#2e7d32",
        "cloth_color": "#2e7d32",
        "coat_color": "#201c1a",
        "mane_color": "#0c0a0a",
        "fur_map": "/textures/horses/skins/03-black-fur.jpg?v=3",
    },
    {
        "number": 4,
        "name": "#4 Grey",
        "silk_color": "#f9a825",
        "cloth_color": "#f9a825",
        "coat_color": "#a8a5a0",
        "mane_color": "#5a5854",
        "fur_map": "/textures/horses/skins/04-grey-fur.jpg?v=3",
    },
    {
        "number": 5,
        "name": "#5 Palomino",
        "silk_color": "#6a1b9a",
        "cloth_color": "#6a1b9a",
        "coat_color": "#d2a55f",
        "mane_color": "#ebe1cd",
        "fur_map": "/textures/horses/skins/05-palomino-fur.jpg?v=3",
    },
    {
        "number": 6,
        "name": "#6 Pinto",
        "silk_color": "#00838f",
        "cloth_color": "#00838f",
        "coat_color": "#694830",
        "mane_color": "#1e1814",
        "fur_map": "/textures/horses/skins/06-pinto-fur.jpg?v=3",
    },
]


class Command(BaseCommand):
    help = "Seed the six racehorses used by the Gallop frontend."

    def handle(self, *args, **options):
        created = 0
        updated = 0
        for row in FIELD:
            _, was_created = Horse.objects.update_or_create(
                number=row["number"],
                defaults={**row, "is_active": True},
            )
            if was_created:
                created += 1
            else:
                updated += 1
        self.stdout.write(
            self.style.SUCCESS(
                f"Horses ready — created {created}, updated {updated}."
            )
        )
