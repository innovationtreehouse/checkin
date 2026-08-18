"""Tests for the offline scan queue: durability across restart, ordered
replay, no-double-submit under the idempotency rules, and the queued/offline
banner (#1257)."""

import os
import tempfile
import unittest
from unittest.mock import MagicMock

from outbox import Outbox, classify_response, replay_drain, new_event_id, now_iso
from client import handle_scan, _saved_banner_html


class _StopLoop(Exception):
    """Sentinel to escape replay_drain's `while True` in tests."""


class FakeState:
    def __init__(self):
        self.events = []

    def push_event(self, data):
        self.events.append(data)


class TestOutboxDurability(unittest.TestCase):
    def test_pending_rows_survive_process_restart(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "outbox.db")
            ob1 = Outbox(path)
            ob1.enqueue("evt-1", "42", "2026-08-18T10:00:00+00:00")

            # Simulate a restart: a fresh Outbox instance over the same file.
            ob2 = Outbox(path)
            rows = ob2.pending_rows()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], "evt-1")

    def test_corrupt_file_moved_aside_and_queue_still_usable(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "outbox.db")
            with open(path, "wb") as f:
                f.write(b"not a sqlite file at all, definitely corrupt\x00\x01")

            ob = Outbox(path)  # must not raise, must not block scanning
            ob.enqueue("evt-1", "1", now_iso())
            self.assertEqual(ob.pending_count(), 1)

            corrupt_files = [f for f in os.listdir(d) if ".corrupt." in f]
            self.assertEqual(len(corrupt_files), 1)


class TestOutboxOrderingAndDedup(unittest.TestCase):
    def test_pending_rows_ordered_by_scanned_at(self):
        with tempfile.TemporaryDirectory() as d:
            ob = Outbox(os.path.join(d, "outbox.db"))
            ob.enqueue("evt-b", "1", "2026-08-18T10:05:00+00:00")
            ob.enqueue("evt-a", "2", "2026-08-18T10:00:00+00:00")
            ob.enqueue("evt-c", "3", "2026-08-18T10:10:00+00:00")

            ids = [r[0] for r in ob.pending_rows()]
            self.assertEqual(ids, ["evt-a", "evt-b", "evt-c"])

    def test_enqueue_same_event_id_twice_is_a_noop(self):
        with tempfile.TemporaryDirectory() as d:
            ob = Outbox(os.path.join(d, "outbox.db"))
            ob.enqueue("evt-1", "1", now_iso())
            ob.enqueue("evt-1", "1", now_iso())
            self.assertEqual(ob.pending_count(), 1)

    def test_has_pending_for_participant(self):
        with tempfile.TemporaryDirectory() as d:
            ob = Outbox(os.path.join(d, "outbox.db"))
            self.assertFalse(ob.has_pending_for_participant("7"))
            ob.enqueue("evt-1", "7", now_iso())
            self.assertTrue(ob.has_pending_for_participant("7"))
            ob.ack("evt-1")
            self.assertFalse(ob.has_pending_for_participant("7"))

    def test_ack_removes_dead_marks_and_keeps(self):
        with tempfile.TemporaryDirectory() as d:
            ob = Outbox(os.path.join(d, "outbox.db"))
            ob.enqueue("evt-1", "1", now_iso())
            ob.enqueue("evt-2", "2", now_iso())

            ob.ack("evt-1")
            ob.mark_dead("evt-2", 404)

            self.assertEqual(ob.pending_rows(), [])
            self.assertEqual(ob.dead_count(), 1)


class TestClassifyResponse(unittest.TestCase):
    def test_ack_cases(self):
        for status, body in [
            (200, {"type": "checkin"}),
            (200, {"type": "checkout"}),
            (200, {"type": "duplicate_ignored"}),
            (200, {"type": "ignored_debounce"}),
            (200, {"type": "parked"}),
            (400, {"type": "warning", "error": "force close caution"}),
        ]:
            self.assertEqual(classify_response(status, body), "ack", (status, body))

    def test_dead_cases(self):
        for status in (400, 404, 409):
            self.assertEqual(classify_response(status, {"error": "nope"}), "dead")

    def test_retry_cases(self):
        for status, body in [
            (0, {"error": "timeout"}),
            (503, {}),
            (429, {}),
            (401, {}),
            (500, {}),
            (502, {}),
            (400, {"type": "warming"}),
        ]:
            self.assertEqual(classify_response(status, body), "retry", (status, body))


class TestReplayDrain(unittest.TestCase):
    def _run(self, responses):
        """responses: list of (body, status, retry_after) yielded in order by send_fn."""
        with tempfile.TemporaryDirectory() as d:
            ob = Outbox(os.path.join(d, "outbox.db"))
            for i in range(len(responses)):
                ob.enqueue(f"evt-{i}", str(i), f"2026-08-18T10:0{i}:00+00:00")

            calls = {"n": 0}

            def send_fn(participant_id, client_event_id, scanned_at):
                idx = calls["n"]
                calls["n"] += 1
                return responses[idx]

            sleeps = []

            def fake_sleep(secs):
                sleeps.append(secs)
                if calls["n"] >= len(responses):
                    raise _StopLoop()

            with self.assertRaises(_StopLoop):
                replay_drain(ob, send_fn, push_fn=None, sleep_fn=fake_sleep)
            return ob

    def test_acked_events_are_removed_in_order(self):
        ob = self._run([
            ({"type": "checkin"}, 200, None),
            ({"type": "checkout"}, 200, None),
        ])
        self.assertEqual(ob.pending_rows(), [])

    def test_dead_event_is_marked_and_does_not_block_the_next_one(self):
        ob = self._run([
            ({"error": "unknown participant"}, 404, None),
            ({"type": "checkin"}, 200, None),
        ])
        self.assertEqual(ob.dead_count(), 1)
        self.assertEqual(ob.pending_rows(), [])

    def test_retry_keeps_the_event_pending(self):
        ob = self._run([
            ({}, 503, "30"),
        ])
        self.assertEqual(len(ob.pending_rows()), 1)
        self.assertEqual(ob.pending_rows()[0][3], 1)  # attempts bumped

    def test_same_client_event_id_reused_across_retries_until_acked(self):
        # The idempotency key must not change between attempts -- a retried
        # send after a warming/network failure is a redelivery of the same
        # event, not a new one, or server-side dedup can't do its job.
        with tempfile.TemporaryDirectory() as d:
            ob = Outbox(os.path.join(d, "outbox.db"))
            ob.enqueue("evt-fixed", "1", now_iso())

            seen_ids = []

            def send_fn(participant_id, client_event_id, scanned_at):
                seen_ids.append(client_event_id)
                if len(seen_ids) < 3:
                    return ({}, 503, None)
                return ({"type": "duplicate_ignored"}, 200, None)

            def fake_sleep(secs):
                if len(seen_ids) >= 3:
                    raise _StopLoop()

            with self.assertRaises(_StopLoop):
                replay_drain(ob, send_fn, push_fn=None, sleep_fn=fake_sleep)

            self.assertEqual(seen_ids, ["evt-fixed", "evt-fixed", "evt-fixed"])
            self.assertEqual(ob.pending_rows(), [])


class TestHandleScanQueuesOnFailure(unittest.TestCase):
    def _backend(self, post_scan_return, attendance_path=None):
        backend = MagicMock()
        backend.post_scan.return_value = post_scan_return
        backend.attendance_path = attendance_path
        return backend

    def test_network_failure_queues_and_shows_saved_banner(self):
        with tempfile.TemporaryDirectory() as d:
            ob = Outbox(os.path.join(d, "outbox.db"))
            backend = self._backend(({"error": "Connection refused"}, 0, None))
            state = FakeState()

            handle_scan(backend, state, ob, "9")

            self.assertEqual(ob.pending_count(), 1)
            self.assertIn("Saved", state.events[-1]["html"])
            self.assertIn("1 waiting", state.events[-1]["html"])

    def test_successful_scan_is_not_queued(self):
        with tempfile.TemporaryDirectory() as d:
            ob = Outbox(os.path.join(d, "outbox.db"))
            backend = self._backend((
                {"type": "checkin", "participant": {"email": "a@b.com"}, "message": "Checked in successfully"},
                200,
                None,
            ))
            state = FakeState()

            handle_scan(backend, state, ob, "9")

            self.assertEqual(ob.pending_count(), 0)
            self.assertIn("banner-ok", state.events[-1]["html"])

    def test_dead_letter_response_is_not_queued(self):
        with tempfile.TemporaryDirectory() as d:
            ob = Outbox(os.path.join(d, "outbox.db"))
            backend = self._backend(({"error": "unknown participant"}, 404, None))
            state = FakeState()

            handle_scan(backend, state, ob, "9")

            self.assertEqual(ob.pending_count(), 0)
            self.assertIn("banner-error", state.events[-1]["html"])

    def test_second_scan_for_same_pending_participant_enqueues_behind_first(self):
        with tempfile.TemporaryDirectory() as d:
            ob = Outbox(os.path.join(d, "outbox.db"))
            backend = self._backend(({"error": "down"}, 0, None))
            state = FakeState()

            handle_scan(backend, state, ob, "9")  # queues evt-1
            handle_scan(backend, state, ob, "9")  # must not attempt live delivery

            self.assertEqual(ob.pending_count(), 2)
            self.assertEqual(backend.post_scan.call_count, 1)
            self.assertIn("2 waiting", state.events[-1]["html"])


class TestSavedBanner(unittest.TestCase):
    def test_banner_text_includes_queue_count(self):
        self.assertIn("3 waiting", _saved_banner_html(3))
        self.assertIn("banner-saved", _saved_banner_html(0))


if __name__ == "__main__":
    unittest.main()
