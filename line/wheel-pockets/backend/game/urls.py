from django.urls import path
from . import views
urlpatterns = [
    path('config/', views.config_view),
    path('session/', views.session_create),
    path('session/<uuid:player_id>/', views.session_detail),
    path('play/', views.play_view),
]
