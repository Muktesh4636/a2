#!/usr/bin/env python3
from pathlib import Path
import re

conf = Path("/etc/nginx/sites-enabled/gunduata.tech")
text = conf.read_text()
marker = "# === SPORTS LIVE HLS (auto) ==="
if marker in text:
    text = re.sub(
        r"\n    # === SPORTS LIVE HLS \(auto\) ===.*?# === END SPORTS LIVE HLS ===\n",
        "\n",
        text,
        flags=re.S,
    )
block = """
    # === SPORTS LIVE HLS (auto) ===
    location /sports-live/ {
        proxy_pass http://72.61.254.71:8158/hls/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        add_header Access-Control-Allow-Origin * always;
        add_header Cache-Control "no-cache, no-store" always;
    }
    # === END SPORTS LIVE HLS ===
"""
if marker not in text:
    text2, n = re.subn(r"(\n\s*location /api/ \{)", block + r"\1", text, count=1)
    if n != 1:
        raise SystemExit("Could not insert sports-live nginx block")
    conf.write_text(text2)
    print("inserted sports-live block")
else:
    conf.write_text(text)
