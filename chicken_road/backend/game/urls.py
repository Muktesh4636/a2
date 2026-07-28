from django.urls import path

from game import views

urlpatterns = [
    path('player/', views.PlayerCreateView.as_view(), name='player-create'),
    path('player/me/', views.PlayerMeView.as_view(), name='player-me'),
    path('config/', views.ConfigView.as_view(), name='config'),
    path('game/start/', views.GameStartView.as_view(), name='game-start'),
    path('game/<uuid:round_id>/', views.GameDetailView.as_view(), name='game-detail'),
    path('game/<uuid:round_id>/go/', views.GameGoView.as_view(), name='game-go'),
    path('game/<uuid:round_id>/cashout/', views.GameCashoutView.as_view(), name='game-cashout'),
    path('live/', views.LiveWinsView.as_view(), name='live'),
]
