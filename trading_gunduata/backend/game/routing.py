from django.urls import re_path
from .consumers import RoundConsumer

websocket_urlpatterns = [
    re_path(r'^ws/round/$', RoundConsumer.as_asgi()),
]
