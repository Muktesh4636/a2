from django.urls import path

from . import views

urlpatterns = [
    path('config/', views.config_view, name='config'),
    path('session/', views.session_create, name='session-create'),
    path('session/<uuid:player_id>/', views.session_detail, name='session-detail'),
    path('play/', views.play_view, name='play'),
]
