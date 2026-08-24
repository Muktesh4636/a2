"""Sports hub + match detail HTML pages and static JS helpers."""

from django.http import FileResponse, Http404
from django.shortcuts import render
from pathlib import Path

_TEMPLATES = Path(__file__).resolve().parent / "templates" / "sports"


def sports_ui(request):
    return render(request, "sports/index.html")


def sports_match_ui(request):
    return render(request, "sports/match/index.html")


def _serve_sports_asset(filename: str):
    path = _TEMPLATES / filename
    if not path.is_file():
        raise Http404
    content_type = "application/javascript" if filename.endswith(".js") else "text/plain"
    return FileResponse(open(path, "rb"), content_type=content_type)


def sports_auth_wallet_js(request):
    return _serve_sports_asset("_auth_wallet.js")


def sports_live_tv_js(request):
    return _serve_sports_asset("live-tv.js")


def sports_betslip_js(request):
    return _serve_sports_asset("betslip.js")
