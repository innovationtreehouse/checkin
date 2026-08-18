"""Guard against #1616: version_poller's self-update exit must not
restart-loop when git pull can't fast-forward on the Pi."""

import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from client import (
    _read_last_restart_target,
    _write_last_restart_target,
    _should_restart_for_update,
    version_poller,
)


class TestShouldRestartForUpdate(unittest.TestCase):
    def test_no_prior_target_restarts(self):
        self.assertTrue(_should_restart_for_update("bbb", None))

    def test_same_target_as_last_restart_does_not_restart(self):
        self.assertFalse(_should_restart_for_update("bbb", "bbb"))

    def test_new_target_past_last_restart_restarts_again(self):
        self.assertTrue(_should_restart_for_update("ccc", "bbb"))


class TestStateFileRoundTrip(unittest.TestCase):
    def test_missing_file_reads_as_none(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(_read_last_restart_target(os.path.join(d, "state")))

    def test_write_then_read_round_trips(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "state")
            self.assertTrue(_write_last_restart_target("deadbeef", path))
            self.assertEqual(_read_last_restart_target(path), "deadbeef")

    def test_unwritable_path_reports_failure(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "missing-dir", "state")
            with self.assertLogs("kiosk", level="WARNING"):
                self.assertFalse(_write_last_restart_target("deadbeef", path))


class _StopLoop(Exception):
    """Sentinel used to escape version_poller's `while True`."""


class TestVersionPollerLoopGuard(unittest.TestCase):
    """Runs the real version_poller loop against a scripted head sequence:
    mismatch -> one restart; non-advancing pull -> no second exit (logged);
    remote moves on -> restart allowed again. Matches issue #1616."""

    def _run(self, head_sequence, state_name="state"):
        backend = MagicMock()
        backend.get_server_version.return_value = ("v1", 200)
        state = MagicMock()

        calls = []

        def fake_check_output(cmd, text=True):
            calls.append(cmd)
            local, remote = head_sequence[(len(calls) - 1) // 2]
            return local if cmd[-1] == "HEAD" else remote

        def fake_sleep(_):
            fake_sleep.n += 1
            if fake_sleep.n > len(head_sequence):
                raise _StopLoop()
        fake_sleep.n = 0

        with tempfile.TemporaryDirectory() as d:
            state_path = os.path.join(d, state_name)
            with patch("client.subprocess.run"), \
                 patch("client.subprocess.check_output", side_effect=fake_check_output), \
                 patch("client.os._exit") as exit_mock, \
                 patch("client.time.sleep", side_effect=fake_sleep):
                with self.assertRaises(_StopLoop):
                    version_poller(backend, state, interval=0, state_path=state_path)
        return exit_mock

    def test_mismatch_then_stuck_pull_then_genuine_advance(self):
        heads = [
            ("aaa", "bbb"),  # mismatch, never tried -> restart
            ("aaa", "bbb"),  # pull didn't advance, same target -> no restart
            ("aaa", "ccc"),  # remote moved on -> restart again
        ]
        with self.assertLogs("kiosk", level="WARNING") as logs:
            exit_mock = self._run(heads)

        self.assertEqual(exit_mock.call_count, 2)
        self.assertTrue(any("did not advance" in m for m in logs.output))

    def test_unwritable_state_file_does_not_exit(self):
        """Write failure must keep the client up: exiting without the sha on
        disk leaves the next boot unable to see the attempt (#1616 again)."""
        heads = [("aaa", "bbb"), ("aaa", "bbb")]
        with self.assertLogs("kiosk", level="WARNING") as logs:
            exit_mock = self._run(heads, state_name="missing-dir/state")

        exit_mock.assert_not_called()
        self.assertTrue(any("Not restarting" in m for m in logs.output))


if __name__ == "__main__":
    unittest.main()
