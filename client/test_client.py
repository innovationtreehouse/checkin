import inspect
import json
import os
import unittest
from unittest.mock import MagicMock

from nacl.signing import SigningKey

from client import BackendClient, DEFAULT_KIOSK_PATH, main

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
        client.post_scan(7, "evt-1", "2026-08-18T10:00:00+00:00", **kwargs)
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

if __name__ == "__main__":
    unittest.main()
