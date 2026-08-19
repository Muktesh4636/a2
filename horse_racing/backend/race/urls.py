from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("horses", views.HorseViewSet, basename="horse")
router.register("races", views.RaceViewSet, basename="race")

urlpatterns = [
    path("health/", views.health, name="health"),
    path("leaderboard/", views.leaderboard, name="leaderboard"),
    path("", include(router.urls)),
]
