from django.urls import path
from . import views

urlpatterns = [
    # Auth
    path('auth/register/', views.register),
    path('auth/login/', views.login_view),
    path('auth/logout/', views.logout_view),
    path('auth/me/', views.me),

    # Wallet
    path('wallet/', views.wallet),
    path('wallet/deposit/', views.deposit),

    # Rounds
    path('rounds/current/', views.current_round),
    path('rounds/history/', views.round_history),
    path('rounds/settle/', views.settle_round),

    # Betting
    path('bets/place/', views.place_bet),
    path('bets/cashout/', views.cashout),
    path('bets/my/', views.my_bets),

    # Transactions & leaderboard
    path('transactions/', views.my_transactions),
    path('leaderboard/', views.leaderboard),
]
