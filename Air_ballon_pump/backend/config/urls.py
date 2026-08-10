from django.contrib import admin
from django.urls import include, path

from game.static_serve import frontend_asset, frontend_image, frontend_index

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("game.urls")),
    path("", frontend_index, name="frontend"),
    path("images/<str:name>", frontend_image, name="frontend-image"),
    path("<str:name>", frontend_asset, name="frontend-asset"),
]
