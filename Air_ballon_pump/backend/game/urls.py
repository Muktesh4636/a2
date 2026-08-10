from django.urls import path

from . import views

urlpatterns = [
    path("bootstrap/", views.bootstrap, name="game-bootstrap"),
    path("state/", views.state, name="game-state"),
    path("round/start/", views.round_start, name="round-start"),
    path("round/pump/", views.round_pump, name="round-pump"),
    path("round/cashout/", views.round_cashout, name="round-cashout"),
]
