import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace

import requests

import health


class TestDiagnose(unittest.TestCase):
    def test_200_is_ok(self):
        get = Mock(return_value=SimpleNamespace(status_code=200))
        self.assertEqual(health.diagnose("http://x", get_fn=get, gateway_fn=lambda: True), health.OK)

    def test_503_is_warming(self):
        get = Mock(return_value=SimpleNamespace(status_code=503))
        self.assertEqual(health.diagnose("http://x", get_fn=get, gateway_fn=lambda: True), health.WARMING)

    def test_connection_error_without_gateway_is_L2(self):
        get = Mock(side_effect=requests.exceptions.ConnectionError("down"))
        self.assertEqual(health.diagnose("http://x", get_fn=get, gateway_fn=lambda: False), health.L2)

    def test_connection_error_with_gateway_is_L4(self):
        get = Mock(side_effect=requests.exceptions.ConnectionError("down"))
        self.assertEqual(health.diagnose("http://x", get_fn=get, gateway_fn=lambda: True), health.L4)

    def test_timeout_with_gateway_is_L4(self):
        get = Mock(side_effect=requests.exceptions.Timeout())
        self.assertEqual(health.diagnose("http://x", get_fn=get, gateway_fn=lambda: True), health.L4)


class TestHealthMonitorTick(unittest.TestCase):
    def test_silent_through_closed_window(self):
        state = Mock()
        mon = health.HealthMonitor("http://x", state)
        called = {"n": 0}

        def diagnose_fn(_url):
            called["n"] += 1
            return health.OK

        self.assertIsNone(mon.tick(diagnose_fn=diagnose_fn, in_closed_fn=lambda: True))
        self.assertEqual(called["n"], 0)

    def test_does_not_wifi_bounce_on_L4(self):
        state = Mock()
        mon = health.HealthMonitor("http://x", state, allow_wifi_bounce=True)
        with patch.object(health, "_wifi_bounce") as bounce:
            mon.tick(now=1000, diagnose_fn=lambda _u: health.L4, in_closed_fn=lambda: False)
            bounce.assert_not_called()

    def test_wifi_bounce_on_L2_when_enabled(self):
        state = Mock()
        mon = health.HealthMonitor("http://x", state, allow_wifi_bounce=True)
        with patch.object(health, "_wifi_bounce") as bounce:
            mon.tick(now=1000, diagnose_fn=lambda _u: health.L2, in_closed_fn=lambda: False)
            bounce.assert_called_once()


if __name__ == "__main__":
    unittest.main()
