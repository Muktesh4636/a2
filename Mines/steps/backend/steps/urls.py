from django.urls import path

from .views import (
    GameCashOutView,
    GameChooseView,
    GameDetailView,
    GameStartView,
    PlayerMeView,
)

urlpatterns = [
    path('player/', PlayerMeView.as_view(), name='player-me'),
    path('games/start/', GameStartView.as_view(), name='game-start'),
    path('games/<uuid:game_id>/', GameDetailView.as_view(), name='game-detail'),
    path('games/<uuid:game_id>/choose/', GameChooseView.as_view(), name='game-choose'),
    path('games/<uuid:game_id>/cashout/', GameCashOutView.as_view(), name='game-cashout'),
]
