from django.urls import path

from .views import (
    GameCashOutView,
    GameDetailView,
    GameRevealView,
    GameStartView,
    PlayerMeView,
)

urlpatterns = [
    path('player/', PlayerMeView.as_view(), name='player-me'),
    path('games/start/', GameStartView.as_view(), name='game-start'),
    path('games/<uuid:game_id>/', GameDetailView.as_view(), name='game-detail'),
    path('games/<uuid:game_id>/reveal/', GameRevealView.as_view(), name='game-reveal'),
    path('games/<uuid:game_id>/cashout/', GameCashOutView.as_view(), name='game-cashout'),
]
