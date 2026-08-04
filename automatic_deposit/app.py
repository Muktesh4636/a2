"""Web API: PhonePe transactions via mobile companion app (no ADB required).

Optional legacy ADB mode remains available for local USB debugging.
"""

from __future__ import annotations

import os

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS

import storage

app = Flask(__name__)
CORS(app)

ALLOWED_LIMITS = {3, 5, 10}
ADB_ENABLED = os.environ.get("ENABLE_ADB", "0") == "1"


@app.before_request
def _ensure_db():
    storage.init_db()


@app.get("/")
def home():
    return render_template("index.html", sync_token=storage.get_sync_token())


@app.get("/api/health")
def health():
    info = storage.last_sync_info()
    return jsonify(
        {
            "ok": True,
            "mode": "mobile",
            "adb_enabled": ADB_ENABLED,
            "transactions_stored": info["count"],
            "last_synced_at": info["last_synced_at"],
        }
    )


@app.get("/api/sync/token")
def api_sync_token():
    return jsonify({"ok": True, "sync_token": storage.get_sync_token()})


@app.post("/api/sync/token/rotate")
def api_rotate_token():
    token = storage.rotate_sync_token()
    return jsonify({"ok": True, "sync_token": token})


@app.post("/api/sync")
def api_sync():
    """Mobile app posts PhonePe transactions here (with UTR)."""
    data = request.get_json(silent=True) or {}
    token = (
        request.headers.get("X-Sync-Token")
        or data.get("sync_token")
        or ""
    ).strip()
    if not token or token != storage.get_sync_token():
        return jsonify({"ok": False, "error": "Invalid sync token"}), 401

    device_id = (data.get("device_id") or "unknown").strip()[:120]
    items = data.get("transactions") or []
    if not isinstance(items, list) or not items:
        return jsonify({"ok": False, "error": "transactions array required"}), 400

    saved = storage.upsert_transactions(device_id, items)
    return jsonify({"ok": True, "saved": saved, "device_id": device_id})


@app.post("/api/transactions")
def api_list_transactions():
    """Return last 3 / 5 / 10 from mobile-synced store (includes UTR)."""
    payload = request.get_json(silent=True) or {}
    raw = payload.get("limit", 5)
    try:
        limit = int(raw)
    except (TypeError, ValueError):
        limit = 5
    if limit not in ALLOWED_LIMITS:
        return jsonify({"ok": False, "error": "limit must be 3, 5, or 10"}), 400

    source = (payload.get("source") or "mobile").lower()

    # Legacy USB/ADB path (opt-in)
    if source == "adb" and ADB_ENABLED:
        try:
            from phonepe_adb import PhonePeError, list_transactions_with_details

            items = list_transactions_with_details(limit=limit)
            return jsonify(
                {
                    "ok": True,
                    "count": len(items),
                    "limit": limit,
                    "source": "adb",
                    "transactions": items,
                }
            )
        except PhonePeError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400
        except Exception as exc:  # noqa: BLE001
            return jsonify({"ok": False, "error": f"Unexpected error: {exc}"}), 500

    items = storage.list_recent(limit=limit)
    if not items:
        return jsonify(
            {
                "ok": False,
                "error": (
                    "No transactions synced yet. Install the companion app on the phone, "
                    "enable Accessibility, fetch Last 3/5/10 in the app, then try again."
                ),
                "count": 0,
                "limit": limit,
                "source": "mobile",
                "transactions": [],
            }
        ), 404

    return jsonify(
        {
            "ok": True,
            "count": len(items),
            "limit": limit,
            "source": "mobile",
            "transactions": items,
        }
    )


@app.get("/api/transactions/<int:index>")
def api_transaction_detail(index: int):
    raw = request.args.get("limit", 5)
    try:
        limit = int(raw)
    except ValueError:
        limit = 5
    if limit not in ALLOWED_LIMITS:
        return jsonify({"ok": False, "error": "limit must be 3, 5, or 10"}), 400
    items = storage.list_recent(limit=limit)
    if index < 1 or index > len(items):
        return jsonify({"ok": False, "error": f"No transaction #{index}"}), 404
    return jsonify({"ok": True, "transaction": items[index - 1]})


def _require_sync_token() -> str | None:
    """Return error message if token invalid; None if OK."""
    token = (
        request.headers.get("X-Sync-Token")
        or request.args.get("sync_token")
        or ""
    ).strip()
    if not token or token != storage.get_sync_token():
        return "Invalid or missing sync token (header X-Sync-Token)"
    return None


@app.get("/api/deposits")
def api_deposits():
    """Fetch deposit amount + UTR list from server (for your backend).

    Headers: X-Sync-Token: <token>
    Query:   limit=20  (optional)
    """
    err = _require_sync_token()
    if err:
        return jsonify({"ok": False, "error": err}), 401

    try:
        limit = int(request.args.get("limit", 20))
    except ValueError:
        limit = 20

    deposits = storage.list_deposits(limit=limit, only_with_utr=True)
    # Minimal payload for deposit matching
    slim = [
        {
            "deposit_amount": d["deposit_amount"],
            "utr": d["utr"],
            "party": d["party"],
            "type": d["type"],
            "datetime": d["datetime"],
            "phonepe_txn_id": d["phonepe_txn_id"],
        }
        for d in deposits
    ]
    return jsonify({"ok": True, "count": len(slim), "deposits": slim})


@app.get("/api/deposits/utr/<utr>")
def api_deposit_by_utr(utr: str):
    """Look up one deposit by UTR. Returns deposit_amount + utr."""
    err = _require_sync_token()
    if err:
        return jsonify({"ok": False, "error": err}), 401

    deposit = storage.find_deposit_by_utr(utr)
    if not deposit:
        return jsonify({"ok": False, "error": "UTR not found"}), 404

    return jsonify(
        {
            "ok": True,
            "deposit": {
                "deposit_amount": deposit["deposit_amount"],
                "utr": deposit["utr"],
                "party": deposit["party"],
                "type": deposit["type"],
                "datetime": deposit["datetime"],
                "phonepe_txn_id": deposit["phonepe_txn_id"],
            },
        }
    )


if __name__ == "__main__":
    # 0.0.0.0 so the phone on same Wi‑Fi can reach the server
    app.run(host="0.0.0.0", port=5055, debug=True)
