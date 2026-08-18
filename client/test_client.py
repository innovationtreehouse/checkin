import inspect
import json
import os
import unittest
from client import BackendClient, DEFAULT_KIOSK_PATH, handle_scan, main


class FakeBackend:
    attendance_path = ""

    def __init__(self, body, status=200):
        self._reply = (body, status)

    def post_scan(self, participant_id):
        return self._reply


class FakeState:
    def __init__(self):
        self.events = []

    def push_event(self, event):
        self.events.append(event)


def scan_banner(body, status=200):
    state = FakeState()
    handle_scan(FakeBackend(body, status), state, 1)
    return state.events[0]["html"]


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

if __name__ == "__main__":
    unittest.main()
