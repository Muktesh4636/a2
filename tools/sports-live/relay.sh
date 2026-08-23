#!/bin/sh
# Resolve Radhe/premiumodds HLS and relay to local /hls for nginx.
set -eu

EVENT_ID="${EVENT_ID:-28327605}"
RELAY_IP="${SPORTS_LIVE_RELAY_IP:-72.61.254.71}"
OUT_DIR="${OUT_DIR:-/hls}"
LIST="${OUT_DIR}/stream.m3u8"
RESOLVER="${RESOLVER:-/app/resolve_stream.js}"

mkdir -p "$OUT_DIR"

echo "[sports-live] event=$EVENT_ID relay_ip=$RELAY_IP"

while true; do
  JSON=$(node "$RESOLVER" "$EVENT_ID" "$RELAY_IP" 2>/dev/null || echo '{"ok":false}')
  SOURCE=$(echo "$JSON" | sed -n 's/.*"hls_upstream":"\([^"]*\)".*/\1/p')

  if [ -z "$SOURCE" ] || [ "$SOURCE" = "null" ]; then
    echo "[sports-live] no HLS yet (embed-only / starting soon), retry in 15s"
    sleep 15
    continue
  fi

  echo "[sports-live] pulling $SOURCE"
  ffmpeg -hide_banner -loglevel warning \
    -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
    -i "$SOURCE" \
    -c copy \
    -f hls \
    -hls_time 1 \
    -hls_list_size 3 \
    -hls_flags delete_segments+append_list+omit_endlist+program_date_time+split_by_time \
    "$LIST" || echo "[sports-live] ffmpeg exited, re-resolving..."
  sleep 3
done
