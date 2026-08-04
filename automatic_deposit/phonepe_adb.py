"""ADB helpers to read PhonePe History + transaction detail (incl. UTR)."""

from __future__ import annotations

import re
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path

PHONEPE_PACKAGE = "com.phonepe.app"
PHONEPE_MAIN = "com.phonepe.app/.ui.activity.Navigator_MainActivity"


class PhonePeError(RuntimeError):
    pass


@dataclass
class TransactionSummary:
    index: int
    type: str
    party: str
    amount: str
    when: str
    note: str = ""


@dataclass
class TransactionDetail:
    index: int
    status: str
    datetime: str
    type: str
    party: str
    amount: str
    upi_or_bank: str
    phonepe_txn_id: str
    utr: str
    debited_from: str
    extra: dict


def _run(cmd: list[str], timeout: float = 30) -> str:
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise PhonePeError("adb not found. Install Android platform-tools and ensure adb is on PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise PhonePeError(f"Command timed out: {' '.join(cmd)}") from exc
    if proc.returncode != 0 and "Warning:" not in (proc.stderr or ""):
        err = (proc.stderr or proc.stdout or "").strip()
        if err and "already running" not in err.lower():
            # Many adb shell cmds still succeed with warnings; only fail on hard errors.
            if "error:" in err.lower() or "device offline" in err.lower() or "no devices" in err.lower():
                raise PhonePeError(err)
    return (proc.stdout or "").strip()


def ensure_device() -> str:
    out = _run(["adb", "devices", "-l"])
    lines = [ln for ln in out.splitlines()[1:] if ln.strip()]
    if not lines:
        raise PhonePeError("No phone connected. Plug in USB and enable USB debugging.")
    for ln in lines:
        parts = ln.split()
        if len(parts) >= 2 and parts[1] == "device":
            return parts[0]
        if len(parts) >= 2 and parts[1] == "unauthorized":
            raise PhonePeError("Phone is unauthorized. Unlock and tap Allow USB debugging.")
    raise PhonePeError(f"Phone not ready:\n{out}")


def _shell(args: list[str], timeout: float = 30) -> str:
    return _run(["adb", "shell", *args], timeout=timeout)


def _tap(x: int, y: int) -> None:
    _shell(["input", "tap", str(x), str(y)])


def _back() -> None:
    _shell(["input", "keyevent", "4"])


def _dump_ui() -> ET.Element:
    remote = "/sdcard/pp_ui_dump.xml"
    _shell(["uiautomator", "dump", remote], timeout=20)
    with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as tmp:
        local = Path(tmp.name)
    _run(["adb", "pull", remote, str(local)])
    try:
        root = ET.parse(local).getroot()
    finally:
        local.unlink(missing_ok=True)
    return root


def _nodes_with_text(root: ET.Element) -> list[dict]:
    rows = []
    for n in root.iter("node"):
        text = (n.attrib.get("text") or "").strip()
        desc = (n.attrib.get("content-desc") or "").strip()
        if not text and not desc:
            continue
        bounds = n.attrib.get("bounds") or ""
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
        cx = cy = None
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        rows.append(
            {
                "text": text,
                "desc": desc,
                "bounds": bounds,
                "cx": cx,
                "cy": cy,
                "clickable": n.attrib.get("clickable") == "true",
            }
        )
    return rows


def _current_package() -> str:
    out = _run(["adb", "shell", "dumpsys", "window"])
    m = re.search(r"mCurrentFocus=Window\{[^ ]+ [^ ]+ ([^/}+]+)", out)
    return m.group(1) if m else ""


def open_phonepe_home() -> None:
    ensure_device()
    _run(
        [
            "adb",
            "shell",
            "am",
            "start",
            "-n",
            PHONEPE_MAIN,
        ]
    )
    time.sleep(2.2)
    # If still not PhonePe, try launcher intent
    if PHONEPE_PACKAGE not in _current_package():
        _shell(
            [
                "monkey",
                "-p",
                PHONEPE_PACKAGE,
                "-c",
                "android.intent.category.LAUNCHER",
                "1",
            ]
        )
        time.sleep(2.5)


def _is_history_screen(rows: list[dict]) -> bool:
    texts = {r["text"] for r in rows}
    return "History" in texts and ("My Statements" in texts or "Filter" in texts or any(
        r["text"] in {"Paid to", "Transfer to", "Received from"} for r in rows
    ))


def _tap_bottom_history(rows: list[dict]) -> bool:
    bottom = next(
        (r for r in rows if r["text"] == "History" and r["cy"] and r["cy"] > 1100),
        None,
    )
    if not bottom:
        return False
    _tap(bottom["cx"], bottom["cy"])
    time.sleep(2.2)
    return True


def _goto_history_from_anywhere(rows: list[dict]) -> list[dict]:
    """Land on the main History tab (not filtered 'View History' from a receipt)."""
    if _is_history_screen(rows):
        return rows

    # Prefer Home tab then History (avoids filtered history from receipt)
    home = next((r for r in rows if r["text"] == "Home" and r["cy"] and r["cy"] > 1100), None)
    if home:
        _tap(home["cx"], home["cy"])
        time.sleep(1.4)
        rows = _nodes_with_text(_dump_ui())
        if _tap_bottom_history(rows):
            return _nodes_with_text(_dump_ui())

    if _tap_bottom_history(rows):
        return _nodes_with_text(_dump_ui())

    # Back out of nested screens, then History tab
    for _ in range(4):
        _back()
        time.sleep(1.0)
        rows = _nodes_with_text(_dump_ui())
        if _is_history_screen(rows):
            return rows
        home = next((r for r in rows if r["text"] == "Home" and r["cy"] and r["cy"] > 1100), None)
        if home:
            _tap(home["cx"], home["cy"])
            time.sleep(1.2)
            rows = _nodes_with_text(_dump_ui())
        if _tap_bottom_history(rows):
            return _nodes_with_text(_dump_ui())

    return rows


def open_history() -> list[dict]:
    # Kill/relaunch so we don't stay on a filtered receipt stack
    ensure_device()
    _shell(["am", "force-stop", PHONEPE_PACKAGE])
    time.sleep(0.6)
    open_phonepe_home()
    rows = _nodes_with_text(_dump_ui())
    rows = _goto_history_from_anywhere(rows)
    if not _is_history_screen(rows):
        open_phonepe_home()
        rows = _goto_history_from_anywhere(_nodes_with_text(_dump_ui()))
    if not _is_history_screen(rows):
        raise PhonePeError("Could not find History tab. Unlock PhonePe (PIN/fingerprint) and try again.")
    return rows


def _parse_history_list(rows: list[dict], limit: int = 5) -> list[TransactionSummary]:
    """Parse History list rows into summaries."""
    texts = [r for r in rows if r["text"]]
    # Find first "Paid to" / "Transfer to" / "Received from" below the month header
    type_labels = {"Paid to", "Transfer to", "Received from", "Paid securely", "Money added"}
    starts = []
    for i, r in enumerate(texts):
        if r["text"] in type_labels and r["cy"] and r["cy"] > 400:
            starts.append(i)
    summaries: list[TransactionSummary] = []
    for idx, start in enumerate(starts[:limit]):
        chunk = texts[start : starts[idx + 1] if idx + 1 < len(starts) else start + 6]
        labels = [c["text"] for c in chunk]
        txn_type = labels[0] if labels else ""
        party = labels[1] if len(labels) > 1 else ""
        amount = next((t for t in labels if t.startswith("₹") or t.startswith("+ ₹")), "")
        when = next(
            (
                t
                for t in labels
                if re.search(
                    r"\bago\b|Yesterday|Today|\d{1,2}:\d{2}|\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)",
                    t,
                    re.I,
                )
            ),
            "",
        )
        note = next((t for t in labels if t in {"Debited from", "Credited to", "Paid from"}), "")
        # Tap target: roughly middle of the row
        cy = chunk[0]["cy"]
        if len(chunk) > 1 and chunk[1]["cy"]:
            cy = (chunk[0]["cy"] + chunk[1]["cy"]) // 2
        summaries.append(
            TransactionSummary(
                index=idx + 1,
                type=txn_type,
                party=party,
                amount=amount,
                when=when,
                note=note,
            )
        )
        # stash tap y on object for later
        summaries[-1].__dict__["_tap_y"] = cy  # type: ignore[attr-defined]
        summaries[-1].__dict__["_tap_x"] = 360  # type: ignore[attr-defined]
    return summaries


def _summary_key(s: TransactionSummary) -> tuple:
    return (s.type, s.party, s.amount)


def _swipe_history_up() -> None:
    # Swipe list upward to reveal older transactions
    _shell(["input", "swipe", "360", "1250", "360", "520", "350"])
    time.sleep(1.3)


def _collect_history(limit: int) -> list[TransactionSummary]:
    """Read History, scrolling if needed, until `limit` unique txs (or no more)."""
    limit = max(1, min(10, int(limit)))
    rows = open_history()
    collected: list[TransactionSummary] = []
    seen: set[tuple] = set()
    stagnant = 0

    while len(collected) < limit and stagnant < 3:
        batch = _parse_history_list(rows, limit=10)
        added = 0
        for s in batch:
            key = _summary_key(s)
            if key in seen:
                continue
            seen.add(key)
            s.index = len(collected) + 1
            collected.append(s)
            added += 1
            if len(collected) >= limit:
                break
        if added == 0:
            stagnant += 1
        else:
            stagnant = 0
        if len(collected) >= limit:
            break
        _swipe_history_up()
        rows = _nodes_with_text(_dump_ui())

    if not collected:
        raise PhonePeError(
            "No transactions found on History. Unlock PhonePe and open History once, then retry."
        )
    return collected[:limit]


def list_transactions(limit: int = 5) -> list[dict]:
    global _LAST_SUMMARIES, _LAST_LIMIT
    limit = max(1, min(10, int(limit)))
    summaries = _collect_history(limit)
    _LAST_SUMMARIES = summaries
    _LAST_LIMIT = limit
    return [asdict(s) for s in summaries]


_LAST_SUMMARIES: list[TransactionSummary] = []
_LAST_LIMIT: int = 5
_LAST_DETAILS: list[dict] = []


def _parse_detail(rows: list[dict], index: int) -> TransactionDetail:
    texts = [r["text"] for r in rows if r["text"]]
    joined = "\n".join(texts)

    status = next((t for t in texts if "Successful" in t or "Failed" in t or "Pending" in t), "")
    datetime = next(
        (t for t in texts if re.search(r"\d{1,2}:\d{2}\s*(am|pm).*?\d{4}", t, re.I)),
        "",
    )
    txn_type = next((t for t in texts if t in {"Paid to", "Transfer to", "Received from", "Paid securely"}), "")
    # party is usually the line after type
    party = ""
    amount = ""
    for i, t in enumerate(texts):
        if t == txn_type and i + 1 < len(texts):
            party = texts[i + 1]
            # amount often nearby
            for j in range(i + 1, min(i + 4, len(texts))):
                if texts[j].startswith("₹") or texts[j].startswith("+ ₹"):
                    amount = texts[j]
                    break
            break

    upi = next(
        (
            t
            for t in texts
            if "@" in t or t in {"Canara Bank", "Union Bank of India"} or t.startswith("XX")
        ),
        "",
    )
    # Prefer UPI id over XX account if both present near top
    for t in texts:
        if "@" in t:
            upi = t
            break

    txn_id = ""
    for i, t in enumerate(texts):
        if "PhonePe Transaction ID" in t and i + 1 < len(texts):
            txn_id = texts[i + 1]
            break
        if re.fullmatch(r"T\d{10,}", t):
            txn_id = t
            break

    utr = ""
    m = re.search(r"UTR[:\s]*([A-Za-z0-9]+)", joined, re.I)
    if m:
        utr = m.group(1)
    else:
        for t in texts:
            if t.upper().startswith("UTR"):
                utr = re.sub(r"^UTR[:\s]*", "", t, flags=re.I).strip()

    debited = ""
    for i, t in enumerate(texts):
        if t == "Debited from" and i + 1 < len(texts):
            # next non-amount label
            for j in range(i + 1, min(i + 4, len(texts))):
                if not texts[j].startswith("₹"):
                    debited = texts[j]
                    break
            break

    banking_name = ""
    for i, t in enumerate(texts):
        if t == "Banking Name" and i + 2 < len(texts):
            banking_name = texts[i + 2] if texts[i + 1] == ":" else texts[i + 1]

    if not status and "History" in texts:
        raise PhonePeError("Still on History list — could not open transaction detail. Try again.")

    return TransactionDetail(
        index=index,
        status=status,
        datetime=datetime,
        type=txn_type,
        party=party,
        amount=amount,
        upi_or_bank=upi,
        phonepe_txn_id=txn_id,
        utr=utr,
        debited_from=debited,
        extra={"banking_name": banking_name} if banking_name else {},
    )


def _find_and_open_summary(
    target: TransactionSummary,
    scan_limit: int,
    *,
    restart: bool = True,
    rows: list[dict] | None = None,
) -> list[dict]:
    """Scroll History until target row is visible, then tap it. Returns post-tap UI rows."""
    if restart or rows is None:
        rows = open_history()
    key = _summary_key(target)
    stagnant = 0
    scanned = 0

    while stagnant < 4:
        batch = _parse_history_list(rows, limit=10)
        scanned = max(scanned, len(batch))
        match = next((s for s in batch if _summary_key(s) == key), None)
        if match:
            tap_x = getattr(match, "_tap_x", 360)
            tap_y = getattr(match, "_tap_y", None)
            if not tap_y:
                raise PhonePeError("Could not locate transaction row to open.")
            _tap(int(tap_x), int(tap_y))
            time.sleep(2.6)
            return _nodes_with_text(_dump_ui())
        before = [_summary_key(s) for s in batch]
        _swipe_history_up()
        rows = _nodes_with_text(_dump_ui())
        after_batch = _parse_history_list(rows, limit=10)
        after = [_summary_key(s) for s in after_batch]
        if before == after:
            stagnant += 1
        else:
            stagnant = 0
        if scanned >= scan_limit and stagnant >= 2:
            break

    raise PhonePeError(f"Could not find transaction #{target.index} on screen. Try Get Last again.")


def get_transaction_detail(index: int, limit: int | None = None) -> dict:
    if index < 1 or index > 10:
        raise PhonePeError("Index must be between 1 and 10.")

    ensure_device()
    scan_limit = limit or _LAST_LIMIT or 10
    scan_limit = max(index, min(10, int(scan_limit)))

    # Prefer cached list from the last "Get Last N" click
    if _LAST_SUMMARIES and index <= len(_LAST_SUMMARIES):
        target = _LAST_SUMMARIES[index - 1]
    else:
        summaries = _collect_history(scan_limit)
        if index > len(summaries):
            raise PhonePeError(f"Only {len(summaries)} recent transactions found.")
        target = summaries[index - 1]

    detail_rows = _find_and_open_summary(target, scan_limit=scan_limit)
    detail = _parse_detail(detail_rows, index)

    # Return to history for next pick
    _back()
    time.sleep(1.2)

    if not detail.utr and not detail.phonepe_txn_id:
        raise PhonePeError("Opened a screen but could not read UTR. Unlock PhonePe and retry.")

    return asdict(detail)


def list_transactions_with_details(limit: int = 5) -> list[dict]:
    """Fetch last N transactions and open each to capture UTR + full details."""
    global _LAST_SUMMARIES, _LAST_LIMIT, _LAST_DETAILS
    limit = max(1, min(10, int(limit)))
    summaries = _collect_history(limit)
    _LAST_SUMMARIES = summaries
    _LAST_LIMIT = limit

    details: list[dict] = []
    rows = open_history()
    for summary in summaries:
        try:
            detail_rows = _find_and_open_summary(
                summary,
                scan_limit=limit,
                restart=False,
                rows=rows,
            )
            detail = _parse_detail(detail_rows, summary.index)
            details.append(asdict(detail))
        except PhonePeError as exc:
            details.append(
                {
                    "index": summary.index,
                    "status": "Unavailable",
                    "datetime": "",
                    "type": summary.type,
                    "party": summary.party,
                    "amount": summary.amount,
                    "upi_or_bank": "",
                    "phonepe_txn_id": "",
                    "utr": "",
                    "debited_from": "",
                    "extra": {"error": str(exc), "when": summary.when},
                }
            )
        finally:
            _back()
            time.sleep(1.2)
            rows = _nodes_with_text(_dump_ui())
            if not _is_history_screen(rows):
                rows = open_history()

    _LAST_DETAILS = details
    return details
