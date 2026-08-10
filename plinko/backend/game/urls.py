from django.urls import path

from .views import (
    BetHistoryView,
    HealthView,
    MultipliersView,
    PlaceBetView,
    PlayerMeView,
    PlayerResetView,
)

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("player/me/", PlayerMeView.as_view(), name="player-me"),
    path("player/reset/", PlayerResetView.as_view(), name="player-reset"),
    path("multipliers/", MultipliersView.as_view(), name="multipliers"),
    path("bets/", PlaceBetView.as_view(), name="place-bet"),
    path("bets/history/", BetHistoryView.as_view(), name="bet-history"),
]
