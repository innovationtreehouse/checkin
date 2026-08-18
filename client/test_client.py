import inspect
import json
import os
import unittest
from unittest.mock import Mock, patch
from client import AttendanceState, BackendClient, DEFAULT_KIOSK_PATH, handle_scan, main

class TestBackendClient(unittest.TestCase):
    def test_required_methods_exist(self):
        """Ensure BackendClient has the necessary structural methods."""
        # We don't need real keys or URLs for structural method existence checks
        # So we can pass strings and None.
        client = BackendClient("http://fake", "fake_key")

        self.assertTrue(hasattr(client, "post_scan"), "BackendClient is missing post_scan method")
        self.assertTrue(hasattr(client, "get_attendance"), "BackendClient is missing get_attendance method")
        self.assertTrue(hasattr(client, "_headers"), "BackendClient is missing _headers method")

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
        }, 400)

        handle_scan(backend, state, 7)

        self.assertEqual(backend.post_scan.call_args.args, (7, None))
        self.assertEqual(events[0]["countdown"], 15)
        self.assertIn('id="fc-countdown"', events[0]["html"])

        backend.post_scan.return_value = ({
            "type": "checkout", "message": "Checked out and Facility closed",
            "participant": {"email": "k@example.com"},
        }, 200)
        handle_scan(backend, state, 7)

        self.assertEqual(backend.post_scan.call_args.args, (7, "tok-1"))
        self.assertEqual(events[1]["countdown"], 0)

if __name__ == "__main__":
    unittest.main()
