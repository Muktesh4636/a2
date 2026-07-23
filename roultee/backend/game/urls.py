from django.urls import path

from game import views

urlpatterns = [
    path("session/", views.SessionCreateView.as_view(), name="session-create"),
    path("me/", views.MeView.as_view(), name="me"),
    path("bets/", views.PlaceBetView.as_view(), name="bets-place"),
    path("bets/undo/", views.UndoBetView.as_view(), name="bets-undo"),
    path("bets/double/", views.DoubleBetsView.as_view(), name="bets-double"),
    path("bets/clear/", views.ClearBetsView.as_view(), name="bets-clear"),
    path("spin/", views.SpinView.as_view(), name="spin"),
    path("history/", views.HistoryView.as_view(), name="history"),
]
