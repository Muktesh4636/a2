from django.urls import include, path, re_path

from game.views import frontend, images

urlpatterns = [
    path("api/", include("game.urls")),
    path("images/<path:path>", images, name="images"),
    path("", frontend, {"path": "index.html"}),
    re_path(r"^(?P<path>.+)$", frontend),
]
