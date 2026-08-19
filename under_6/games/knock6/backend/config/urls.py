from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve
from django.conf import settings

from game.views import index

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("game.urls")),
    path("", index, name="index"),
    # Serve frontend assets from ../frontend
    re_path(
        r"^(?P<path>(?:styles\.css|game\.js|table3d\.js).*)$",
        serve,
        {"document_root": settings.FRONTEND_DIR},
    ),
]
