from pathlib import Path

from django.http import FileResponse, Http404
from django.views.decorators.http import require_GET

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
IMAGES_DIR = FRONTEND_DIR / "images"

ASSET_TYPES = {
    "styles.css": "text/css",
    "game.js": "application/javascript",
}

IMAGE_TYPES = {
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
}


@require_GET
def frontend_index(_request):
    path = FRONTEND_DIR / "index.html"
    if not path.exists():
        raise Http404("Frontend index.html not found")
    return FileResponse(path.open("rb"), content_type="text/html")


@require_GET
def frontend_asset(_request, name):
    if name not in ASSET_TYPES:
        raise Http404()
    path = FRONTEND_DIR / name
    if not path.exists():
        raise Http404()
    return FileResponse(path.open("rb"), content_type=ASSET_TYPES[name])


@require_GET
def frontend_image(_request, name):
    # Only serve files that actually live in frontend/images/
    path = (IMAGES_DIR / name).resolve()
    if not str(path).startswith(str(IMAGES_DIR.resolve())):
        raise Http404()
    if not path.is_file():
        raise Http404()
    content_type = IMAGE_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path.open("rb"), content_type=content_type)
