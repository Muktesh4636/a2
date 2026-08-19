from django.urls import path

from . import views

urlpatterns = [
    path('bootstrap/', views.BootstrapView.as_view()),
    path('history/', views.HistoryView.as_view()),
    path('round/', views.CurrentRoundView.as_view()),
    path('round/new/', views.NewRoundView.as_view()),
    path('round/start/', views.StartRoundView.as_view()),
    path('round/crash/', views.CrashRoundView.as_view()),
    path('bet/', views.PlaceBetView.as_view()),
    path('cashout/', views.CashOutView.as_view()),
]
