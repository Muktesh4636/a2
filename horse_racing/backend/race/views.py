from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from .models import Bet, Horse, Race, RaceEntry
from .serializers import (
    BetSerializer,
    FinishRaceSerializer,
    HorseSerializer,
    LeaderboardEntrySerializer,
    PlaceBetSerializer,
    RaceSerializer,
)


class HorseViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Horse.objects.filter(is_active=True)
    serializer_class = HorseSerializer


class RaceViewSet(viewsets.ModelViewSet):
    queryset = Race.objects.prefetch_related(
        "entries__horse", "bets__horse"
    ).select_related("winner")
    serializer_class = RaceSerializer
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        """Start a new race with the active field."""
        horses = list(Horse.objects.filter(is_active=True).order_by("number")[:6])
        if len(horses) < 1:
            return Response(
                {"detail": "No horses seeded. Run: python manage.py seed_horses"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        total_laps = int(
            request.data.get("total_laps", getattr(settings, "RACE_TOTAL_LAPS", 3))
        )

        with transaction.atomic():
            race = Race.objects.create(
                status=Race.Status.RACING,
                total_laps=total_laps,
                started_at=timezone.now(),
            )
            for index, horse in enumerate(horses):
                RaceEntry.objects.create(
                    race=race,
                    horse=horse,
                    lane=index,
                )

        serializer = self.get_serializer(race)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="bets")
    def place_bet(self, request, pk=None):
        """Place a win bet on a horse in this race."""
        race = self.get_object()
        if race.status == Race.Status.FINISHED:
            return Response(
                {"detail": "Race already finished."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload = PlaceBetSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        horse = Horse.objects.filter(
            number=data["horse_number"], is_active=True
        ).first()
        if horse is None:
            return Response(
                {"detail": "Horse not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        bet = Bet.objects.create(
            race=race,
            horse=horse,
            amount=data["amount"],
            odds=data["odds"],
            status=Bet.Status.OPEN,
        )
        return Response(BetSerializer(bet).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="finish")
    def finish(self, request, pk=None):
        """Record final placings and mark the race finished."""
        race = self.get_object()
        if race.status == Race.Status.FINISHED:
            return Response(
                {"detail": "Race already finished.", "race": RaceSerializer(race).data},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload = FinishRaceSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        with transaction.atomic():
            winner = None
            for item in data["results"]:
                entry = self._resolve_entry(race, item)
                if entry is None:
                    continue
                entry.finish_position = int(item["finish_position"])
                entry.finish_time_seconds = float(
                    item.get("finish_time_seconds", data["duration_seconds"])
                )
                entry.laps_completed = int(
                    item.get("laps_completed", race.total_laps)
                )
                entry.save(
                    update_fields=[
                        "finish_position",
                        "finish_time_seconds",
                        "laps_completed",
                    ]
                )
                if entry.finish_position == 1:
                    winner = entry.horse

            if winner is None:
                winner = self._winner_from_payload(data)

            race.status = Race.Status.FINISHED
            race.finished_at = timezone.now()
            race.duration_seconds = data["duration_seconds"]
            race.winner = winner
            race.save(
                update_fields=[
                    "status",
                    "finished_at",
                    "duration_seconds",
                    "winner",
                ]
            )

            for bet in race.bets.filter(status=Bet.Status.OPEN).select_related("horse"):
                if winner and bet.horse_id == winner.id:
                    bet.status = Bet.Status.WON
                    bet.payout = (bet.amount * bet.odds).quantize(Decimal("0.01"))
                else:
                    bet.status = Bet.Status.LOST
                    bet.payout = Decimal("0.00")
                bet.save(update_fields=["status", "payout"])

        race = (
            Race.objects.prefetch_related("entries__horse", "bets__horse")
            .select_related("winner")
            .get(pk=race.pk)
        )
        return Response(RaceSerializer(race).data)

    def _resolve_entry(self, race, item):
        if "horse_number" in item:
            return race.entries.filter(horse__number=item["horse_number"]).first()
        if "name" in item:
            return race.entries.filter(horse__name=item["name"]).first()
        return None

    def _winner_from_payload(self, data):
        if data.get("winner_number"):
            return Horse.objects.filter(number=data["winner_number"]).first()
        if data.get("winner_name"):
            return Horse.objects.filter(name=data["winner_name"]).first()
        return None


@api_view(["GET"])
def leaderboard(request):
    """Fastest finished races."""
    races = (
        Race.objects.filter(status=Race.Status.FINISHED, duration_seconds__isnull=False)
        .select_related("winner")
        .order_by("duration_seconds")[:20]
    )
    rows = [
        {
            "race_id": r.id,
            "winner_name": r.winner.name if r.winner else "Unknown",
            "duration_seconds": r.duration_seconds,
            "finished_at": r.finished_at,
        }
        for r in races
    ]
    return Response(LeaderboardEntrySerializer(rows, many=True).data)


@api_view(["GET"])
def health(request):
    return Response({"status": "ok", "service": "gallop-api"})
