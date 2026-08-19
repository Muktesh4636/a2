#!/usr/bin/env python3
"""Ramp synthetic WebRTC (WHEP) subscribers against MediaMTX and report capacity.

  python loadtest.py --peers 100 --ramp 60 --duration 180

Each peer is a real WebRTC peer connection, so the server does the same work it
would for a real viewer. Client-side decoding is the limiting factor on the
generator machine — see README for peers-per-machine guidance and how to shard.
"""

import argparse
import asyncio
import csv
import signal
import sys
import time
from dataclasses import dataclass, field
from urllib.parse import urljoin

try:
    import aiohttp
    from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription
except ImportError as exc:  # pragma: no cover
    sys.exit(f"missing dependency ({exc.name}); run: pip install -r requirements.txt")


# aiortc's inbound-rtp stats report jitter in RTP timestamp units, so it has to
# be divided by the codec clock rate to get seconds.
CLOCK_RATES = {"video": 90000, "audio": 48000}


@dataclass
class Peer:
    index: int
    pc: RTCPeerConnection
    resource: str | None = None
    connected_at: float | None = None
    failed: str | None = None
    tearing_down: bool = False
    bytes_received: int = 0
    packets_received: int = 0
    packets_lost: int = 0
    jitter: float = 0.0


@dataclass
class Sample:
    elapsed: float
    connected: int
    failed: int
    mbps: float
    packets_lost: int
    jitter_ms: float
    server_sessions: int | None = None
    server_mbps: float | None = None


@dataclass
class Run:
    peers: list[Peer] = field(default_factory=list)
    samples: list[Sample] = field(default_factory=list)
    stop: asyncio.Event = field(default_factory=asyncio.Event)


async def whep_subscribe(session: aiohttp.ClientSession, url: str, peer: Peer,
                         media: str, timeout: float) -> None:
    """Negotiate one recvonly WHEP session and wait for it to reach connected."""
    pc = peer.pc
    if media in ("video", "both"):
        pc.addTransceiver("video", direction="recvonly")
    if media in ("audio", "both"):
        pc.addTransceiver("audio", direction="recvonly")

    connected = asyncio.Event()

    @pc.on("connectionstatechange")
    async def on_state_change() -> None:
        if peer.tearing_down:
            return
        if pc.connectionState == "connected":
            connected.set()
        elif pc.connectionState in ("failed", "closed"):
            peer.failed = peer.failed or pc.connectionState
            connected.set()

    await pc.setLocalDescription(await pc.createOffer())

    async with session.post(
        url,
        data=pc.localDescription.sdp,
        headers={"Content-Type": "application/sdp"},
    ) as resp:
        body = await resp.text()
        if resp.status not in (200, 201):
            peer.failed = f"http {resp.status}"
            return
        location = resp.headers.get("Location")
        peer.resource = urljoin(url, location) if location else None

    await pc.setRemoteDescription(RTCSessionDescription(sdp=body, type="answer"))

    try:
        await asyncio.wait_for(connected.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        peer.failed = "ice timeout"
        return

    if peer.failed is None:
        peer.connected_at = time.monotonic()


async def collect_peer_stats(peer: Peer) -> None:
    if peer.connected_at is None:
        return
    try:
        report = await peer.pc.getStats()
    except Exception:
        return
    total_bytes = packets = lost = 0
    jitter = 0.0
    for stat in report.values():
        kind = getattr(stat, "type", None)
        if kind == "transport":
            # Byte counters only exist at transport level in aiortc.
            total_bytes += getattr(stat, "bytesReceived", 0) or 0
        elif kind == "inbound-rtp":
            packets += getattr(stat, "packetsReceived", 0) or 0
            lost += getattr(stat, "packetsLost", 0) or 0
            rate = CLOCK_RATES.get(getattr(stat, "kind", ""), 90000)
            jitter = max(jitter, (getattr(stat, "jitter", 0.0) or 0.0) / rate)
    peer.bytes_received = total_bytes
    peer.packets_received = packets
    peer.packets_lost = lost
    peer.jitter = jitter


async def scrape_server(session: aiohttp.ClientSession,
                        metrics_url: str | None) -> tuple[int | None, int | None]:
    """Return (active webrtc sessions, total outbound bytes) from MediaMTX metrics."""
    if not metrics_url:
        return None, None
    try:
        async with session.get(metrics_url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
            text = await resp.text()
    except Exception:
        return None, None

    aggregate_sessions: int | None = None
    labelled_sessions = 0
    saw_labelled = False
    session_outbound = 0
    saw_session_outbound = False
    path_outbound = 0
    saw_path_outbound = False
    for line in text.splitlines():
        if line.startswith("#"):
            continue
        # The mediamtx_ prefix is present in some versions and absent in others.
        name, _, value = line.partition(" ")
        bare = name.removeprefix("mediamtx_")
        try:
            number = float(value)
        except ValueError:
            continue
        if bare == "webrtc_sessions":
            aggregate_sessions = int(number)
        elif bare.startswith("webrtc_sessions{"):
            # With sessions active, MediaMTX emits one labelled line per session
            # instead of an aggregate count.
            labelled_sessions += int(number)
            saw_labelled = True
        elif bare.startswith("webrtc_sessions_outbound_bytes"):
            session_outbound += int(number)
            saw_session_outbound = True
        elif bare.startswith("paths_outbound_bytes"):
            path_outbound += int(number)
            saw_path_outbound = True

    sessions = labelled_sessions if saw_labelled else aggregate_sessions
    # Per-session counters reflect the tracks each viewer actually negotiated;
    # the path counter assumes every reader takes the whole stream.
    if saw_session_outbound:
        return sessions, session_outbound
    return sessions, (path_outbound if saw_path_outbound else None)


async def sampler(run: Run, session: aiohttp.ClientSession, metrics_url: str | None,
                  started: float, interval: float) -> None:
    prev_bytes = 0
    prev_time = started
    prev_server_bytes: int | None = None
    while not run.stop.is_set():
        try:
            await asyncio.wait_for(run.stop.wait(), timeout=interval)
            return
        except asyncio.TimeoutError:
            pass

        await asyncio.gather(*(collect_peer_stats(p) for p in run.peers))
        now = time.monotonic()
        total_bytes = sum(p.bytes_received for p in run.peers)
        window = max(now - prev_time, 1e-6)
        mbps = ((total_bytes - prev_bytes) * 8) / window / 1_000_000
        prev_bytes, prev_time = total_bytes, now

        connected = sum(1 for p in run.peers if p.connected_at and not p.failed)
        failed = sum(1 for p in run.peers if p.failed)
        lost = sum(p.packets_lost for p in run.peers)
        jitter_ms = max((p.jitter for p in run.peers), default=0.0) * 1000

        server_sessions, server_bytes = await scrape_server(session, metrics_url)
        server_mbps = None
        if server_bytes is not None:
            if prev_server_bytes is not None:
                server_mbps = ((server_bytes - prev_server_bytes) * 8) / window / 1_000_000
            prev_server_bytes = server_bytes

        sample = Sample(
            elapsed=now - started,
            connected=connected,
            failed=failed,
            mbps=mbps,
            packets_lost=lost,
            jitter_ms=jitter_ms,
            server_sessions=server_sessions,
            server_mbps=server_mbps,
        )
        run.samples.append(sample)
        line = (f"[{sample.elapsed:6.1f}s] connected={connected:5d} failed={failed:4d} "
                f"client_rx={mbps:7.2f} Mbps lost={lost:6d} jitter={jitter_ms:6.1f} ms")
        if server_sessions is not None:
            line += f" server_sessions={server_sessions:5d}"
        if server_mbps is not None:
            line += f" server_tx={server_mbps:7.2f} Mbps"
        print(line, flush=True)


async def teardown(run: Run, session: aiohttp.ClientSession) -> None:
    async def close(peer: Peer) -> None:
        peer.tearing_down = True
        if peer.resource:
            try:
                await session.delete(peer.resource, timeout=aiohttp.ClientTimeout(total=3))
            except Exception:
                pass
        try:
            await peer.pc.close()
        except Exception:
            pass

    await asyncio.gather(*(close(p) for p in run.peers))


def summarise(run: Run, target_peers: int) -> None:
    connected = [p for p in run.peers if p.connected_at and not p.failed]
    failures: dict[str, int] = {}
    for p in run.peers:
        if p.failed:
            failures[p.failed] = failures.get(p.failed, 0) + 1

    peak = max((s.mbps for s in run.samples), default=0.0)
    steady = run.samples[len(run.samples) // 2:] or run.samples
    avg = sum(s.mbps for s in steady) / len(steady) if steady else 0.0
    lost = sum(p.packets_lost for p in run.peers)
    received = sum(p.packets_received for p in run.peers)
    loss_pct = (lost / (lost + received) * 100) if (lost + received) else 0.0

    print("\n" + "=" * 62)
    print(f"target peers          : {target_peers}")
    print(f"connected             : {len(connected)}")
    print(f"failed                : {sum(failures.values())}" + (f"  {failures}" if failures else ""))
    print(f"peak client rx        : {peak:.2f} Mbps")
    print(f"steady-state client rx: {avg:.2f} Mbps")
    server_peak = max((s.server_mbps for s in run.samples if s.server_mbps is not None), default=None)
    if server_peak is not None:
        print(f"peak server tx        : {server_peak:.2f} Mbps")
    if connected:
        print(f"per-viewer bitrate    : {avg / len(connected) * 1000:.0f} kbps")
    print(f"packet loss           : {loss_pct:.3f}%  ({lost} lost / {received} received)")
    print(f"peak jitter           : {max((s.jitter_ms for s in run.samples), default=0.0):.1f} ms")
    print("=" * 62)
    if failures:
        print("Connections failed — check ICE/UDP reachability before trusting the ceiling.")
    elif loss_pct > 1.0:
        print("Loss above 1% — the server or the path is saturated at this peer count.")
    elif loss_pct > 0.1:
        print("Loss climbing — near the limit of either the server or this generator.")
    else:
        print("Clean run. Raise --peers until loss climbs or connections start failing.")


def write_csv(run: Run, path: str) -> None:
    with open(path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["elapsed_s", "connected", "failed", "client_rx_mbps",
                         "packets_lost", "jitter_ms", "server_sessions", "server_tx_mbps"])
        for s in run.samples:
            writer.writerow([f"{s.elapsed:.1f}", s.connected, s.failed,
                             f"{s.mbps:.2f}", s.packets_lost, f"{s.jitter_ms:.1f}",
                             s.server_sessions if s.server_sessions is not None else "",
                             f"{s.server_mbps:.2f}" if s.server_mbps is not None else ""])
    print(f"samples written to {path}")


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:8889/loadtest/whep",
                    help="WHEP endpoint of the stream under test")
    ap.add_argument("--metrics-url", default="http://127.0.0.1:9998/metrics",
                    help="MediaMTX Prometheus endpoint ('' to skip)")
    ap.add_argument("--peers", type=int, default=50, help="subscribers to reach")
    ap.add_argument("--ramp", type=float, default=30.0, help="seconds to ramp up over")
    ap.add_argument("--duration", type=float, default=120.0,
                    help="seconds to hold at full load after the ramp")
    ap.add_argument("--media", choices=["both", "video", "audio"], default="both",
                    help="audio-only scales much further per generator machine")
    ap.add_argument("--connect-timeout", type=float, default=20.0)
    ap.add_argument("--interval", type=float, default=5.0, help="sampling interval")
    ap.add_argument("--csv", help="write per-sample metrics to this file")
    args = ap.parse_args()

    run = Run()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, run.stop.set)

    started = time.monotonic()
    gap = args.ramp / args.peers if args.peers else 0

    print(f"ramping {args.peers} peers over {args.ramp:.0f}s against {args.url}", flush=True)

    async with aiohttp.ClientSession() as session:
        existing, _ = await scrape_server(session, args.metrics_url or None)
        if existing:
            print(f"warning: server already has {existing} active session(s); "
                  "server_tx and server_sessions will include them", flush=True)

        sample_task = asyncio.create_task(
            sampler(run, session, args.metrics_url or None, started, args.interval)
        )

        async def spawn(index: int) -> None:
            await asyncio.sleep(index * gap)
            if run.stop.is_set():
                return
            peer = Peer(index=index, pc=RTCPeerConnection(RTCConfiguration(iceServers=[])))
            run.peers.append(peer)
            try:
                await whep_subscribe(session, args.url, peer, args.media, args.connect_timeout)
            except Exception as exc:
                peer.failed = type(exc).__name__

        await asyncio.gather(*(spawn(i) for i in range(args.peers)))

        if not run.stop.is_set():
            try:
                await asyncio.wait_for(run.stop.wait(), timeout=args.duration)
            except asyncio.TimeoutError:
                pass

        run.stop.set()
        await sample_task
        await asyncio.gather(*(collect_peer_stats(p) for p in run.peers))
        await teardown(run, session)

    summarise(run, args.peers)
    if args.csv:
        write_csv(run, args.csv)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
