from django.urls import path

from .views import PlayView, PlayerMeView, TrackView

urlpatterns = [
    path('player/', PlayerMeView.as_view(), name='player-me'),
    path('track/', TrackView.as_view(), name='track'),
    path('play/', PlayView.as_view(), name='play'),
]
