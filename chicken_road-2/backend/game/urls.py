from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.HealthView.as_view(), name="health"),
    path("config/", views.ConfigView.as_view(), name="config"),
    path("player/me/", views.PlayerMeView.as_view(), name="player-me"),
    path("player/reset/", views.PlayerResetView.as_view(), name="player-reset"),
    path("rounds/start/", views.RoundStartView.as_view(), name="round-start"),
    path("rounds/<uuid:round_id>/", views.RoundDetailView.as_view(), name="round-detail"),
    path("rounds/<uuid:round_id>/step/", views.RoundStepView.as_view(), name="round-step"),
    path(
        "rounds/<uuid:round_id>/cashout/",
        views.RoundCashOutView.as_view(),
        name="round-cashout",
    ),
]
