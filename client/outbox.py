"""Durable offline scan queue: SQLite outbox + a single FIFO-by-time replay
thread. Kept separate from client.py so it can be imported without touching
client.py's other background threads."""

import logging
import os
import random
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone

log = logging.getLogger("kiosk")

# Start at the waker's Retry-After (~30s), exponential to a ~5 min cap.
MIN_BACKOFF_SECONDS = 30
MAX_BACKOFF_SECONDS = 300
# Also the idle-poll interval and the pace between processed events (ack/dead)
# -- one knob, not two, since both cap the drain loop's cycle time. ~1
# event/sec leaves the shared 300/min scan rate limit mostly to live scans.
DRAIN_PACE_SECONDS = 1.0
# Guard rail against a pathological stuck state. Un-acked rows are never
# evicted to enforce this -- it is a log-only warning, not a hard cap.
WARN_QUEUE_SIZE = 50_000

# docs/designs/KIOSK_RESILIENCE.md D4/Q17: the drain never sends during the
# closed window -- a queued POST is non-GET and wakes the curfewed service.
# The window is 23:00-06:00 local.
CLOSED_WINDOW_START_HOUR = 23  # local time, inclusive
CLOSED_WINDOW_END_HOUR = 6     # local time, exclusive


def in_closed_window(now=None):
    hour = (now or datetime.now()).hour
    if CLOSED_WINDOW_START_HOUR <= CLOSED_WINDOW_END_HOUR:
        return CLOSED_WINDOW_START_HOUR <= hour < CLOSED_WINDOW_END_HOUR
    return hour >= CLOSED_WINDOW_START_HOUR or hour < CLOSED_WINDOW_END_HOUR


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_event_id():
    return str(uuid.uuid4())


class Outbox:
    """One SQLite file, one table. WAL + synchronous=FULL for
    crash-consistency across the kiosk.sh respawn loop and power cuts."""

    def __init__(self, path="outbox.db"):
        self.path = path
        self._lock = threading.RLock()
        self._conn = self._open(path)

    _SCHEMA_SQL = """CREATE TABLE IF NOT EXISTS outbox (
        client_event_id TEXT PRIMARY KEY,
        participant_id  TEXT NOT NULL,
        scanned_at      TEXT NOT NULL,
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_status     INTEGER,
        state           TEXT NOT NULL DEFAULT 'pending',
        created_at      TEXT NOT NULL
    )"""

    def _open(self, path):
        def connect_and_init():
            conn = sqlite3.connect(path, check_same_thread=False)
            try:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=FULL")
                conn.execute(self._SCHEMA_SQL)
                conn.commit()
            except sqlite3.DatabaseError:
                conn.close()
                raise
            return conn

        try:
            return connect_and_init()
        except sqlite3.DatabaseError as e:
            # Scanning must never block on a sick queue: move the corrupt
            # file aside and start fresh.
            corrupt_path = f"{path}.corrupt.{int(time.time())}"
            log.error(f"Outbox {path} unreadable ({e}); moving aside to {corrupt_path}")
            try:
                os.replace(path, corrupt_path)
            except OSError:
                pass
            return connect_and_init()

    def enqueue(self, client_event_id, participant_id, scanned_at):
        """Idempotent: a retried enqueue of the same event is a no-op."""
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO outbox "
                "(client_event_id, participant_id, scanned_at, created_at) VALUES (?,?,?,?)",
                (client_event_id, str(participant_id), scanned_at, now_iso()),
            )
            self._conn.commit()
            n = self.pending_count()
            if n > WARN_QUEUE_SIZE:
                log.warning(f"Outbox has {n} pending rows -- unusually large backlog")

    def has_pending_for_participant(self, participant_id):
        """A fresh scan must not jump its own predecessor in FIFO order."""
        with self._lock:
            row = self._conn.execute(
                "SELECT 1 FROM outbox WHERE participant_id=? AND state='pending' LIMIT 1",
                (str(participant_id),),
            ).fetchone()
            return row is not None

    def pending_count(self):
        with self._lock:
            return self._conn.execute(
                "SELECT COUNT(*) FROM outbox WHERE state='pending'"
            ).fetchone()[0]

    def pending_rows(self):
        """Global FIFO by scanned_at -- trivially preserves per-person order.
        Survives restart: rows persist in the WAL file untouched."""
        with self._lock:
            return self._conn.execute(
                "SELECT client_event_id, participant_id, scanned_at, attempts "
                "FROM outbox WHERE state='pending' ORDER BY scanned_at ASC"
            ).fetchall()

    def ack(self, client_event_id):
        """Server confirmed (2xx, or a dedup/duplicate_ignored response)."""
        with self._lock:
            self._conn.execute("DELETE FROM outbox WHERE client_event_id=?", (client_event_id,))
            self._conn.commit()

    def bump_attempt(self, client_event_id, status):
        with self._lock:
            self._conn.execute(
                "UPDATE outbox SET attempts = attempts + 1, last_status=? WHERE client_event_id=?",
                (status, client_event_id),
            )
            self._conn.commit()

    def mark_dead(self, client_event_id, status):
        """Terminal failure: stop retrying so it stops burning rate limit
        and blocking FIFO. ponytail: dead rows stay local only --
        transmitting them to a server-side DLQ is a later epic slice."""
        with self._lock:
            self._conn.execute(
                "UPDATE outbox SET state='dead', last_status=? WHERE client_event_id=?",
                (status, client_event_id),
            )
            self._conn.commit()

    def dead_count(self):
        with self._lock:
            return self._conn.execute(
                "SELECT COUNT(*) FROM outbox WHERE state='dead'"
            ).fetchone()[0]


def classify_response(status, body):
    """Maps a scan response to one of three outcomes: ack (delete), retry
    (keep, backoff), dead (terminal, stop retrying)."""
    # F2: check first, regardless of status -- post_scan normalizes a
    # non-JSON body (waker HTML, captive portal login, ...) to this sentinel,
    # preserving the intermediary's real status (often 200, not 400), so
    # gating on status==400 alone would falsely ack an unrecorded scan.
    if isinstance(body, dict) and body.get("type") == "warming":
        return "retry"
    if status == 0:
        return "retry"  # network error / timeout -- safe, idempotent retry
    if status in (200, 201):
        # checkin | checkout | duplicate_ignored | ignored_debounce | parked
        return "ack"
    if status == 401:
        return "retry"  # clock skew / key mismatch -- re-signing can recover
    if status == 429:
        return "retry"
    if status == 400 and isinstance(body, dict) and body.get("type") == "warning":
        return "ack"  # force-close caution; the touch WAS recorded server-side
    if status in (400, 404, 409):
        return "dead"
    if status == 503:
        return "retry"  # warming, not failure
    if 500 <= status < 600:
        return "retry"  # handler threw, transaction rolled back, idempotent
    # Unrecognized status: fail safe -- never silently drop a scan.
    return "retry"


def _backoff_seconds(retry_after_header, current_backoff):
    try:
        base = float(retry_after_header) if retry_after_header else current_backoff
    except (TypeError, ValueError):
        base = current_backoff
    base = max(MIN_BACKOFF_SECONDS, min(base, MAX_BACKOFF_SECONDS))
    jitter = base * random.uniform(-0.1, 0.1)
    return max(1.0, base + jitter)


def replay_drain(outbox, send_fn, push_fn=None, sleep_fn=time.sleep, in_closed_window_fn=in_closed_window):
    """Single drain thread: pulls pending rows in scanned_at order,
    resubmits each one (send_fn re-signs per call), and applies the
    ack/retry/dead outcome. Runs forever; call in a background thread."""
    backoff = MIN_BACKOFF_SECONDS
    while True:
        # D4: never send during the closed window -- a queued POST is
        # non-GET and would wake the curfewed service.
        if in_closed_window_fn():
            sleep_fn(DRAIN_PACE_SECONDS)
            continue

        rows = outbox.pending_rows()
        if not rows:
            backoff = MIN_BACKOFF_SECONDS
            sleep_fn(DRAIN_PACE_SECONDS)
            continue

        client_event_id, participant_id, scanned_at, attempts = rows[0]
        # replay=True is what tells the server this is a redelivery: the live
        # attempt already sent this clientEventId (D4 try-first), so only the
        # drain may trip the replay-only guards.
        body, status, retry_after = send_fn(
            participant_id, client_event_id, scanned_at, replay=True
        )
        outcome = classify_response(status, body)

        if outcome == "ack":
            outbox.ack(client_event_id)
            backoff = MIN_BACKOFF_SECONDS
            if push_fn:
                push_fn({"html": "", "queued": outbox.pending_count()})
            sleep_fn(DRAIN_PACE_SECONDS)
        elif outcome == "dead":
            outbox.mark_dead(client_event_id, status)
            log.warning(f"Outbox event {client_event_id} dead-lettered (status={status})")
            backoff = MIN_BACKOFF_SECONDS
            sleep_fn(DRAIN_PACE_SECONDS)
        else:
            outbox.bump_attempt(client_event_id, status)
            wait = _backoff_seconds(retry_after, backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
            sleep_fn(wait)
