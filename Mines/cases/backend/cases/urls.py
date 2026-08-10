from django.urls import path

from .views import PlayView, PlayerMeView, PoolView

urlpatterns = [
    path('player/', PlayerMeView.as_view(), name='player-me'),
    path('pool/', PoolView.as_view(), name='pool'),
    path('play/', PlayView.as_view(), name='play'),
]
