import inspect
import json
import os
import subprocess
import unittest
from datetime import datetime
from unittest.mock import MagicMock, Mock, patch

from nacl.signing import SigningKey

from client import (
    AttendanceState,
    RELEASE_CHANNEL_MARKER,
    RELEASE_TAG_GLOB,
    BackendClient,
    DEFAULT_KIOSK_PATH,
    _scan_result_banner_html,
    attendance_poller,
    handle_scan,
    latest_release_tag,
    main,
    resolve_update_target,
)
from outbox import Outbox, in_closed_window


class _StopLoop(Exception):
    """Sentinel to escape attendance_poller's `while True` in tests."""


def scan_banner(body, status=200):
    # handle_scan now takes an outbox and delegates the markup to this helper;
    # calling it directly tests the same banner without faking a backend.
    return _scan_result_banner_html(body, status)[0]


class TestSupervisionWarningBanner(unittest.TestCase):
    """A scan that succeeds but leaves the room short of supervising adults
    (checkin#1436) still confirms the scan — in amber, which dwells longer."""

    def test_warning_renders_amber_and_still_confirms_the_scan(self):
        html_out = scan_banner({
            "type": "checkout",
            "message": "Checked out successfully",
            "warning": "Warning: only 2 supervising adults remain in the building.",
            "participant": {"email": "a@example.com"},
        })

        self.assertIn("banner-warning", html_out)
        self.assertIn("CHECKED OUT", html_out)
        self.assertIn("only 2 supervising adults remain", html_out)

    def test_warning_is_escaped_like_every_other_backend_value(self):
        html_out = scan_banner({
            "type": "checkin",
            "warning": "<img src=x onerror=alert(1)>",
            "participant": {"email": "a@example.com"},
        })

        self.assertNotIn("<img", html_out)
        self.assertIn("&lt;img", html_out)

    def test_no_warning_leaves_the_ordinary_green_banner(self):
        html_out = scan_banner({
            "type": "checkin",
            "message": "Checked in successfully",
            "participant": {"email": "a@example.com"},
        })

        self.assertIn("banner-ok", html_out)
        self.assertNotIn("banner-warning", html_out)


def _git_stub(tags="", kiosk_sh=None, tag_commit="tagsha", main_head="mainsha"):
    """Stand in for the git calls resolve_update_target makes."""
    def run(argv, **kwargs):
        if argv[:3] == ["git", "tag", "-l"]:
            return tags
        if argv[:2] == ["git", "show"]:
            if kiosk_sh is None:
                raise subprocess.CalledProcessError(128, argv)
            return kiosk_sh
        if argv[:2] == ["git", "rev-list"]:
            return tag_commit + "\n"
        if argv[:2] == ["git", "rev-parse"]:
            return main_head + "\n"
        raise AssertionError(f"unexpected git call: {argv}")
    return run


class TestReleaseChannel(unittest.TestCase):
    """The Pi follows release tags, because the server deploys from them. A Pi
    on main runs client code whose server counterpart is not deployed."""

    def test_tags_are_ranked_by_version_not_by_date(self):
        # v1.10.0 must outrank v1.9.0, and a patch cut later must not outrank a
        # newer minor -- both of which -v:refname gets right and date sorting
        # does not. Asserting the flag because git, not us, does the sorting.
        with patch("client.subprocess.check_output") as co:
            co.return_value = "v1.2.1\nv1.2.0\n"
            self.assertEqual(latest_release_tag(), "v1.2.1")

        argv = co.call_args.args[0]
        self.assertIn("--sort=-v:refname", argv)
        self.assertIn(RELEASE_TAG_GLOB, argv)

    def test_no_tags_at_all_falls_back_to_main(self):
        with patch("client.subprocess.check_output", side_effect=_git_stub(tags="")):
            self.assertEqual(resolve_update_target(), "mainsha")

    def test_a_release_that_tracks_releases_is_adopted(self):
        stub = _git_stub(tags="v1.3.0\n", kiosk_sh=f"# {RELEASE_CHANNEL_MARKER}\n")
        with patch("client.subprocess.check_output", side_effect=stub):
            self.assertEqual(resolve_update_target(), "tagsha")

    def test_a_release_that_still_pulls_main_is_not_adopted(self):
        # The state on the day this landed: the newest release predates the
        # channel. Adopting it would check out a tree that pulls main straight
        # back, restarting the kiosk once per poll, forever.
        stub = _git_stub(tags="v1.2.1\n", kiosk_sh="git pull origin main\n")
        with patch("client.subprocess.check_output", side_effect=stub):
            self.assertEqual(resolve_update_target(), "mainsha")

    def test_a_tag_with_no_kiosk_sh_is_not_adopted(self):
        stub = _git_stub(tags="v0.1.0\n", kiosk_sh=None)
        with patch("client.subprocess.check_output", side_effect=stub):
            self.assertEqual(resolve_update_target(), "mainsha")

    def test_kiosk_sh_carries_the_marker_the_gate_greps_for(self):
        # The gate reads this marker out of a TAG's kiosk.sh. Drop the line here
        # and no future release is ever adopted -- silently, since the fallback
        # is the old behaviour and nothing else changes.
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "kiosk.sh")) as f:
            self.assertIn(RELEASE_CHANNEL_MARKER, f.read())


class TestBackendClient(unittest.TestCase):
    def test_required_methods_exist(self):
        """Ensure BackendClient has the necessary structural methods."""
        # We don't need real keys or URLs for structural method existence checks
        # So we can pass strings and None.
        client = BackendClient("http://fake", "fake_key")

        self.assertTrue(hasattr(client, "post_scan"), "BackendClient is missing post_scan method")
        self.assertTrue(hasattr(client, "get_attendance"), "BackendClient is missing get_attendance method")
        self.assertTrue(hasattr(client, "_headers"), "BackendClient is missing _headers method")

class TestPostScanReplayFlag(unittest.TestCase):
    """The live attempt carries clientEventId (D4 try-first) but no replay
    flag -- the server's replay-only guards must not fire on it."""

    def _payload(self, **kwargs):
        client = BackendClient("http://fake", SigningKey(b"\x00" * 32))
        client.session = MagicMock()
        client.session.post.return_value = MagicMock(
            status_code=200, headers={}, json=lambda: {}
        )
        client.post_scan(
            7, client_event_id="evt-1", scanned_at="2026-08-18T10:00:00+00:00", **kwargs
        )
        return json.loads(client.session.post.call_args.kwargs["data"])

    def test_live_send_carries_the_event_id_but_no_replay_flag(self):
        payload = self._payload()
        self.assertEqual(payload["clientEventId"], "evt-1")
        self.assertNotIn("replay", payload)

    def test_replay_send_sets_the_flag(self):
        self.assertIs(self._payload(replay=True)["replay"], True)


class TestProxyBindsLocalhostOnly(unittest.TestCase):
    def test_server_binds_127_0_0_1_not_0_0_0_0(self):
        """H1: signing proxy must not be reachable over the LAN."""
        src = inspect.getsource(main)
        self.assertIn('"127.0.0.1"', src, "proxy must bind 127.0.0.1")
        self.assertNotIn("0.0.0.0", src, "proxy must not bind 0.0.0.0 (LAN-exposed kiosk-signature oracle)")

class TestExampleConfigMatchesDefaults(unittest.TestCase):
    def test_example_kiosk_path_matches_client_default(self):
        """A fresh Pi copies config.example.json, so its kiosk_path must not
        drift from the in-code default. Does not prove the backend serves it."""
        example = os.path.join(os.path.dirname(__file__), "config.example.json")
        with open(example) as f:
            cfg = json.load(f)
        self.assertEqual(cfg["kiosk_path"], DEFAULT_KIOSK_PATH)

class TestForceCloseConfirm(unittest.TestCase):
    """§5.23 explicit confirm: the warning arms a token, the next scan spends it."""

    def test_post_scan_sends_displayed_intent(self):
        client = BackendClient("http://fake", SigningKey(b"\x00" * 32))
        client.session = MagicMock()
        client.session.post.return_value = MagicMock(status_code=200, headers={}, json=lambda: {})
        client.post_scan(7, intent="IN")
        payload = json.loads(client.session.post.call_args.kwargs["data"])
        self.assertEqual(payload["intent"], "IN")
        client.post_scan(7, intent="OUT", clock_suspect=True)
        payload = json.loads(client.session.post.call_args.kwargs["data"])
        self.assertEqual(payload["intent"], "OUT")
        self.assertTrue(payload["clockSuspect"])

    def test_handle_scan_carries_local_presence_as_intent(self):
        state = AttendanceState()
        state.push_event = lambda event: None
        backend = Mock(attendance_path=None)
        backend.post_scan.return_value = (
            {"type": "checkin", "participant": {"email": "a@example.com"}},
            200,
            None,
        )
        handle_scan(backend, state, Outbox(":memory:"), 7)
        self.assertEqual(backend.post_scan.call_args.kwargs["intent"], "IN")
        handle_scan(backend, state, Outbox(":memory:"), 7)
        self.assertEqual(backend.post_scan.call_args.kwargs["intent"], "OUT")

    def test_post_scan_sends_the_token_only_when_one_is_held(self):
        client = BackendClient("http://fake", "fake_key")
        with patch.object(BackendClient, "_headers", return_value={}), \
             patch.object(client.session, "post") as post:
            post.return_value = Mock(status_code=200, json=Mock(return_value={}))

            client.post_scan(7)
            self.assertEqual(json.loads(post.call_args.kwargs["data"]), {"participantId": 7})

            client.post_scan(7, "tok-1")
            self.assertEqual(json.loads(post.call_args.kwargs["data"]),
                             {"participantId": 7, "forceCloseToken": "tok-1"})

    def test_token_is_single_use_and_dies_with_the_countdown(self):
        state = AttendanceState()
        self.assertIsNone(state.take_confirm())

        state.arm_confirm("tok", 15)
        self.assertEqual(state.take_confirm(), "tok")
        self.assertIsNone(state.take_confirm(), "a spent token must not confirm twice")

        state.arm_confirm("tok", 0)  # countdown already over
        self.assertIsNone(state.take_confirm(), "an expired countdown confirms nothing")

    def test_warning_arms_the_countdown_and_the_next_scan_confirms(self):
        state = AttendanceState()
        events = []
        state.push_event = events.append
        backend = Mock(attendance_path=None)
        backend.post_scan.return_value = ({
            "type": "warning", "error": "others are here",
            "forceCloseToken": "tok-1", "confirmSeconds": 15,
        }, 400, None)

        handle_scan(backend, state, Outbox(":memory:"), 7)

        self.assertIsNone(backend.post_scan.call_args.kwargs["force_close_token"])
        self.assertEqual(events[0]["countdown"], 15)
        self.assertIn('id="fc-countdown"', events[0]["html"])

        backend.post_scan.return_value = ({
            "type": "checkout", "message": "Checked out and Facility closed",
            "participant": {"email": "k@example.com"},
        }, 200, None)
        handle_scan(backend, state, Outbox(":memory:"), 7)

        self.assertEqual(backend.post_scan.call_args.kwargs["force_close_token"], "tok-1")
        self.assertEqual(events[1]["countdown"], 0)

    def test_a_queued_confirm_carries_its_token_into_the_outbox(self):
        """Without this the drain replays token-less and the server parks the
        close for review -- silently undoing the confirm the keyholder gave."""
        state = AttendanceState()
        state.push_event = lambda event: None
        state.arm_confirm("tok-1", 15)
        outbox = Outbox(":memory:")
        backend = Mock(attendance_path=None)
        backend.post_scan.return_value = ({"error": "unreachable"}, 0, None)

        handle_scan(backend, state, outbox, 7)

        rows = outbox.pending_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][4], "tok-1")

    def test_a_queued_scan_behind_a_predecessor_keeps_its_token_too(self):
        state = AttendanceState()
        state.push_event = lambda event: None
        outbox = Outbox(":memory:")
        outbox.enqueue("evt-0", 7, "2026-08-21T10:00:00+00:00")
        state.arm_confirm("tok-2", 15)
        backend = Mock(attendance_path=None)

        handle_scan(backend, state, outbox, 7)

        backend.post_scan.assert_not_called()
        queued = [r for r in outbox.pending_rows() if r[0] != "evt-0"]
        self.assertEqual(queued[0][4], "tok-2")

class TestAttendancePollerClosedWindow(unittest.TestCase):
    """§3.1/Q17: unlike the outbox drain, the poller had no closed-window
    gate -- a 24/7 kiosk pointed at prod defeats the overnight curfew with
    signed GETs every 30s."""

    def _run(self, in_closed_window_fn, iterations=2):
        backend = Mock(attendance_path="/attendance/current")
        backend.get_attendance.return_value = ({"counts": {"total": 1}}, 200)
        state = AttendanceState()
        state.push_event = lambda event: None

        calls = {"n": 0}

        def fake_sleep(secs):
            calls["n"] += 1
            if calls["n"] >= iterations:
                raise _StopLoop()

        with self.assertRaises(_StopLoop):
            attendance_poller(backend, state, sleep_fn=fake_sleep,
                               in_closed_window_fn=in_closed_window_fn)
        return backend

    def test_swallows_the_fetch_at_2330(self):
        backend = self._run(lambda: in_closed_window(datetime(2026, 8, 18, 23, 30)))
        backend.get_attendance.assert_not_called()

    def test_polls_at_1200(self):
        backend = self._run(lambda: in_closed_window(datetime(2026, 8, 18, 12, 0)))
        backend.get_attendance.assert_called()


if __name__ == "__main__":
    unittest.main()
