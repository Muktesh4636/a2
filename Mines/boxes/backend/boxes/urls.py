from django.urls import path

from .views import GameBetView, GameDetailView, GameNewView, GameSelectView, PlayerMeView

urlpatterns = [
    path('player/', PlayerMeView.as_view(), name='player-me'),
    path('games/select/', GameSelectView.as_view(), name='game-select'),
    path('games/bet/', GameBetView.as_view(), name='game-bet'),
    path('games/new/', GameNewView.as_view(), name='game-new'),
    path('games/<uuid:game_id>/', GameDetailView.as_view(), name='game-detail'),
]
