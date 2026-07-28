"""
ASGI config for dice_game project.
"""
import os
import django
import logging

# Set up logging before any other imports
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('game.websocket')

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dice_game.settings')
django.setup()

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

django_asgi_app = get_asgi_application()

from game.routing import websocket_urlpatterns
from dice_game.channels_middleware import JWTAuthMiddleware

# Log startup
logger.info("ASGI application starting up...")

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AuthMiddlewareStack(
        JWTAuthMiddleware(
            URLRouter(websocket_urlpatterns)
        )
    ),
})








