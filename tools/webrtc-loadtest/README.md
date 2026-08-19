# WebRTC capacity test rig

Measures how many concurrent WebRTC viewers a server can actually serve, and at
what bitrate, loss, and jitter. Everything here uses a **synthetic source**
(colour bars + a 1 kHz tone) or a file you own, so the numbers are reproducible
and nothing depends on someone else's stream.

Two pieces:

- `docker-compose.yml` + `mediamtx.yml` — MediaMTX as the WebRTC server, fed by
  an ffmpeg publisher at a fixed bitrate.
- `loadtest.py` — ramps N real WebRTC (WHEP) subscribers, then reports
  client-side throughput/loss/jitter alongside the server's own metrics.

## Setup

```bash
cd tools/webrtc-loadtest

docker compose up -d                      # server + synthetic source

python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

Confirm the stream is live before testing anything:

```bash
open http://127.0.0.1:8889/loadtest       # should show moving colour bars
curl -s http://127.0.0.1:9998/metrics | grep paths_inbound_bytes
```

## Running a test

```bash
# 50 viewers, ramped over 30s, held for 2 minutes
./.venv/bin/python loadtest.py --peers 50 --ramp 30 --duration 120 --csv run50.csv
```

Useful flags:

| Flag | Purpose |
| --- | --- |
| `--url` | WHEP endpoint under test (default `http://127.0.0.1:8889/loadtest/whep`) |
| `--peers` / `--ramp` / `--duration` | load shape, in viewers and seconds |
| `--media audio` | connection/signalling load only; scales far higher per machine |
| `--metrics-url` | MediaMTX Prometheus endpoint, `''` to skip the server-side view |
| `--csv` | per-sample metrics for charting |

Per-sample output looks like:

```
[  15.0s] connected=   19 failed=   0 client_rx=  43.66 Mbps lost=     0 jitter=  14.7 ms server_sessions=   19 server_tx=  43.00 Mbps
```

## Reading the results

- **`connected` vs `--peers`** — the real ceiling. Once connections stop
  completing, you have found the session limit, not a bandwidth limit.
- **`server_tx` vs `client_rx`** — these should track each other closely. A gap
  means packets are being dropped in the path rather than at the server.
- **`per-viewer bitrate`** — should match the source bitrate (2500 kbps by
  default). Sagging well below it means the server is shedding data under load.
- **`packet loss`** — under 0.1% is clean; past ~1% viewers see visible
  artefacts. This is the number that defines your usable capacity.
- **`jitter`** — a healthy local run sits around 15 ms. Sustained growth means
  queues are building somewhere.

Bitrate readings *during the ramp* are inflated, because a peer that joins
mid-window contributes its whole byte counter to that window. Trust the
steady-state figures reported after the ramp finishes.

Capacity planning shortcut: egress is roughly
`viewers x source bitrate`. 1000 viewers at 2.5 Mbps needs ~2.5 Gbps of
outbound bandwidth — for that scale the bottleneck is almost always the network
link and the number of edge nodes, not CPU.

## Generator limits (important)

Each subscriber is a real peer connection and aiortc decodes the media, so the
**load generator saturates long before a real server does**. On a 2-vCPU
container host, ~25 video subscribers already produced client-side loss that had
nothing to do with the server.

To avoid measuring your own laptop:

- Use `--media audio` when you care about session/signalling limits.
- Shard video runs across several machines, each with a slice of the peers, and
  add up the results.
- Cross-check every run against `server_tx` and `server_sessions`. If the server
  reports clean egress while the client reports loss, the generator is the
  bottleneck.

## Testing a remote server

1. Deploy the same compose file there. On Linux, put the `mediamtx` service on
   `network_mode: host` and set `webrtcAdditionalHosts` in `mediamtx.yml` to the
   server's public IP — otherwise ICE advertises addresses clients cannot reach.
2. Open TCP 8889 and UDP 8189.
3. Point the generator at it:

```bash
./.venv/bin/python loadtest.py --url http://SERVER_IP:8889/loadtest/whep \
                              --metrics-url http://SERVER_IP:9998/metrics \
                              --peers 200 --ramp 60 --duration 300
```

## Notes

- `mediamtx.yml` leaves publish/read open and limits api/metrics/pprof to
  loopback plus private ranges. Keep this rig on a closed network; do not expose
  it publicly as-is.
- Between runs, wait for `webrtc_sessions` to return to 0; the script warns if a
  run starts with sessions already active. A generator killed mid-run leaves
  sessions behind that MediaMTX will not reap on its own — clear them through
  the control API:

```bash
curl -s http://127.0.0.1:9997/v3/webrtcsessions/list |
  python3 -c "import json,sys;[print(i['id']) for i in json.load(sys.stdin)['items']]" |
  xargs -I{} curl -s -X POST http://127.0.0.1:9997/v3/webrtcsessions/kick/{}
```
- To test with your own content, mount it into the `source` service and replace
  the two `-f lavfi` inputs with `-stream_loop -1 -i /media/yourfile.mp4`.

```bash
docker compose down            # tear the rig down
```
