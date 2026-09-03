from django.urls import path

from . import views

urlpatterns = [
    path('health/', views.health),
    path('games/', views.games_list),
    path('config/<slug:game_id>/', views.game_config),
    path('session/', views.session_create),
    path('session/<uuid:player_id>/', views.session_detail),
    path('spin/', views.spin_view),
]
