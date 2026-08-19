from django.urls import path

from . import views

urlpatterns = [
    path("state/", views.state, name="state"),
    path("bet/", views.set_bet, name="bet"),
    path("spin/", views.spin, name="spin"),
    path("cashout/", views.cashout, name="cashout"),
    path("part/", views.part, name="part"),
    path("reset/", views.reset, name="reset"),
]
