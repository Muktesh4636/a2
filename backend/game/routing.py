from django.urls import path, re_path
from . import consumers

websocket_urlpatterns = [
    path('ws/game/', consumers.GameConsumer.as_asgi()),
    # Robustness: Handle potential whitespace or newline at end of path
    re_path(r'^ws/game/[\s\n]*$', consumers.GameConsumer.as_asgi()),
]








