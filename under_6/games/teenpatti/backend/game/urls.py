from django.urls import path

from . import views

urlpatterns = [
    path("session/", views.create_session, name="create-session"),
    path("session/<uuid:session_id>/", views.get_session, name="get-session"),
    path("session/<uuid:session_id>/reset/", views.reset_session, name="reset-session"),
    path("session/<uuid:session_id>/history/", views.session_history, name="session-history"),
    path("deal/", views.deal, name="deal"),
    path("decide/", views.decide, name="decide"),
]
