"""SQLite storage for transactions synced from the mobile companion app."""

from __future__ import annotations

import json
import re
import sqlite3
import secrets
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "transactions.db"


def parse_amount(amount_text: str | None) -> float | None:
    """Convert PhonePe amount text like '+ ₹650' / '₹100' to a number."""
    if not amount_text:
        return None
    m = re.search(r"([\d,]+(?:\.\d+)?)", str(amount_text).replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                phonepe_txn_id TEXT,
                utr TEXT,
                status TEXT,
                datetime_text TEXT,
                type TEXT,
                party TEXT,
                amount TEXT,
                upi_or_bank TEXT,
                debited_from TEXT,
                extra_json TEXT,
                synced_at REAL NOT NULL,
                UNIQUE(device_id, phonepe_txn_id, utr, amount, party)
            );
            CREATE INDEX IF NOT EXISTS idx_tx_synced ON transactions(synced_at DESC);
            """
        )
        row = conn.execute("SELECT value FROM settings WHERE key='sync_token'").fetchone()
        if not row:
            token = secrets.token_urlsafe(24)
            conn.execute(
                "INSERT INTO settings(key, value) VALUES('sync_token', ?)",
                (token,),
            )


def get_sync_token() -> str:
    init_db()
    with _conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='sync_token'").fetchone()
        return row["value"] if row else ""


def rotate_sync_token() -> str:
    init_db()
    token = secrets.token_urlsafe(24)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO settings(key, value) VALUES('sync_token', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (token,),
        )
    return token


def upsert_transactions(device_id: str, items: list[dict]) -> int:
    init_db()
    now = time.time()
    count = 0
    with _conn() as conn:
        for item in items:
            conn.execute(
                """
                INSERT INTO transactions(
                    device_id, phonepe_txn_id, utr, status, datetime_text,
                    type, party, amount, upi_or_bank, debited_from, extra_json, synced_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(device_id, phonepe_txn_id, utr, amount, party) DO UPDATE SET
                    status=excluded.status,
                    datetime_text=excluded.datetime_text,
                    type=excluded.type,
                    upi_or_bank=excluded.upi_or_bank,
                    debited_from=excluded.debited_from,
                    extra_json=excluded.extra_json,
                    synced_at=excluded.synced_at
                """,
                (
                    device_id,
                    item.get("phonepe_txn_id") or "",
                    item.get("utr") or "",
                    item.get("status") or "",
                    item.get("datetime") or item.get("datetime_text") or "",
                    item.get("type") or "",
                    item.get("party") or "",
                    item.get("amount") or "",
                    item.get("upi_or_bank") or "",
                    item.get("debited_from") or "",
                    json.dumps(item.get("extra") or {}),
                    now,
                ),
            )
            count += 1
    return count


def list_recent(limit: int = 5, device_id: str | None = None) -> list[dict]:
    init_db()
    limit = max(1, min(10, int(limit)))
    with _conn() as conn:
        if device_id:
            rows = conn.execute(
                """
                SELECT * FROM transactions
                WHERE device_id=?
                ORDER BY synced_at DESC, id DESC
                LIMIT ?
                """,
                (device_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM transactions
                ORDER BY synced_at DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    out = []
    for i, row in enumerate(rows, start=1):
        extra = {}
        try:
            extra = json.loads(row["extra_json"] or "{}")
        except json.JSONDecodeError:
            extra = {}
        amount_text = row["amount"] or ""
        out.append(
            {
                "index": i,
                "status": row["status"],
                "datetime": row["datetime_text"],
                "type": row["type"],
                "party": row["party"],
                "amount": amount_text,
                "deposit_amount": parse_amount(amount_text),
                "upi_or_bank": row["upi_or_bank"],
                "phonepe_txn_id": row["phonepe_txn_id"],
                "utr": row["utr"],
                "debited_from": row["debited_from"],
                "extra": extra,
                "device_id": row["device_id"],
                "synced_at": row["synced_at"],
            }
        )
    return out


def list_deposits(limit: int = 20, only_with_utr: bool = True) -> list[dict]:
    """Compact deposit records: amount + UTR for server consumers."""
    init_db()
    limit = max(1, min(100, int(limit)))
    with _conn() as conn:
        if only_with_utr:
            rows = conn.execute(
                """
                SELECT * FROM transactions
                WHERE utr IS NOT NULL AND TRIM(utr) != ''
                ORDER BY synced_at DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM transactions
                ORDER BY synced_at DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    deposits = []
    for row in rows:
        amount_text = row["amount"] or ""
        deposits.append(
            {
                "deposit_amount": parse_amount(amount_text),
                "amount_text": amount_text,
                "utr": row["utr"] or "",
                "party": row["party"] or "",
                "type": row["type"] or "",
                "datetime": row["datetime_text"] or "",
                "status": row["status"] or "",
                "phonepe_txn_id": row["phonepe_txn_id"] or "",
                "synced_at": row["synced_at"],
            }
        )
    return deposits


def find_deposit_by_utr(utr: str) -> dict | None:
    init_db()
    utr = (utr or "").strip()
    if not utr:
        return None
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT * FROM transactions
            WHERE utr = ?
            ORDER BY synced_at DESC, id DESC
            LIMIT 1
            """,
            (utr,),
        ).fetchone()
    if not row:
        return None
    amount_text = row["amount"] or ""
    return {
        "deposit_amount": parse_amount(amount_text),
        "amount_text": amount_text,
        "utr": row["utr"] or "",
        "party": row["party"] or "",
        "type": row["type"] or "",
        "datetime": row["datetime_text"] or "",
        "status": row["status"] or "",
        "phonepe_txn_id": row["phonepe_txn_id"] or "",
        "synced_at": row["synced_at"],
    }


def last_sync_info() -> dict:
    init_db()
    with _conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c, MAX(synced_at) AS last FROM transactions"
        ).fetchone()
    return {
        "count": int(row["c"] or 0),
        "last_synced_at": row["last"],
    }
