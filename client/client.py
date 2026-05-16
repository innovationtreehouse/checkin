#!/usr/bin/env python3
"""
CheckMeIn Kiosk Client

A thin client for Raspberry Pi that:
  1. Serves a transparent reverse proxy on localhost:8083
  2. Wraps the Next.js frontend in an iframe at GET / pointing to /kioskdisplay
  3. Injects Ed25519 signature headers automatically into proxied API requests
  4. Listens for USB barcode/QR scanner input
"""

import json
import os
import sys
import time
import threading
import logging
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler, ThreadingHTTPServer
from nacl.signing import SigningKey
import requests

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("kiosk")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def load_config(path="config.json"):
    if not os.path.exists(path):
        log.error(f"Config file not found: {path}")
        sys.exit(1)
    with open(path) as f:
        return json.load(f)

# ---------------------------------------------------------------------------
# Signing
# ---------------------------------------------------------------------------
def load_signing_key(path):
    with open(path, "rb") as f:
        seed = f.read()
    return SigningKey(seed)

def sign_request(signing_key, method, path, body=""):
    timestamp = str(int(time.time()))
    message = f"{timestamp}:{method}:{path}:{body}".encode()
    signature = signing_key.sign(message).signature.hex()
    return {
        "X-Kiosk-Timestamp": timestamp,
        "X-Kiosk-Signature": signature,
    }

# ---------------------------------------------------------------------------
# Backend communication & State
# ---------------------------------------------------------------------------
class BackendClient:
    def __init__(self, base_url, signing_key, attendance_path=None):
        self.base_url = base_url.rstrip("/")
        self.signing_key = signing_key
        self.attendance_path = attendance_path
        self.session = requests.Session()

    def _headers(self, method, path, body=""):
        h = sign_request(self.signing_key, method, path, body)
        h["Content-Type"] = "application/json"
        return h

    def post_scan(self, participant_id):
        path = "/api/scan"
        try:
            body = json.dumps({"participantId": int(participant_id)})
        except ValueError:
            body = json.dumps({"participantId": participant_id})
            
        headers = self._headers("POST", path, body)
        try:
            r = self.session.post(
                self.base_url + path, headers=headers, data=body, timeout=10
            )
            return r.json(), r.status_code
        except Exception as e:
            log.error(f"Failed to post scan: {e}")
            return {"error": str(e)}, 0

    def get_attendance(self):
        if not self.attendance_path:
            return {"error": "no attendance_path configured"}, 0
        path = self.attendance_path
        headers = self._headers("GET", path)
        try:
            r = self.session.get(
                self.base_url + path, headers=headers, timeout=10
            )
            return r.json(), r.status_code
        except Exception as e:
            log.error(f"Failed to get attendance: {e}")
            return {"error": str(e)}, 0

    def get_server_version(self):
        path = "/api/kiosk/version"
        headers = self._headers("GET", path)
        try:
            r = self.session.get(
                self.base_url + path, headers=headers, timeout=5
            )
            data = r.json()
            return data.get("version"), r.status_code
        except Exception as e:
            log.error(f"Failed to get server version: {e}")
            return None, 0

class AttendanceState:
    def __init__(self):
        self.lock = threading.Lock()
        self.subscribers = []  # list of queue.Queue for SSE clients
        self.current_counts = {"total": 0, "keyholders": 0, "volunteers": 0, "students": 0}

    def subscribe(self):
        """Register a new SSE client, returns a Queue to read events from."""
        import queue
        q = queue.Queue()
        with self.lock:
            self.subscribers.append(q)
        return q

    def unsubscribe(self, q):
        """Remove an SSE client queue."""
        with self.lock:
            try:
                self.subscribers.remove(q)
            except ValueError:
                pass

    def push_event(self, event_data):
        """Push an event to all connected SSE clients."""
        with self.lock:
            for q in self.subscribers:
                q.put(event_data)

# ---------------------------------------------------------------------------
# Transparent Signing Proxy & Kiosk Handler
# ---------------------------------------------------------------------------
class KioskHandler(BaseHTTPRequestHandler):
    state = None
    backend = None
    kiosk_path = "/kioskdisplay?mode=kiosk"
    disable_blackout = False

    def do_GET(self):
        if self.path == "/":
            self._serve_wrapper()
        elif self.path == "/events":
            self._serve_sse()
        else:
            self._proxy_request("GET")

    def do_POST(self): self._proxy_request("POST")
    def do_PUT(self): self._proxy_request("PUT")
    def do_DELETE(self): self._proxy_request("DELETE")
    def do_PATCH(self): self._proxy_request("PATCH")

    def _serve_wrapper(self):
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CheckMeIn — Kiosk</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body, html {{ width: 100%; height: 100%; overflow: hidden; background: #000; font-family: sans-serif; }}
  iframe {{ width: 100%; height: 100%; border: none; }}
  
  #blackout {{
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #000;
    z-index: 10000;
    display: none;
    pointer-events: none;
  }}

  #flash-container {{
    position: absolute;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    width: 80%;
    max-width: 600px;
    pointer-events: none;
  }}
  .banner {{
    padding: 1.5rem;
    border-radius: 12px;
    margin-bottom: 1rem;
    font-weight: bold;
    font-size: 1.5rem;
    text-align: center;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    animation: fadeout 5s forwards;
  }}
  .banner-ok {{
    background: rgba(16,185,129,0.95);
    border: 2px solid #34d399;
    color: #fff;
  }}
  .banner-error {{
    background: rgba(239,68,68,0.95);
    border: 2px solid #f87171;
    color: #fff;
  }}
  .banner-warning {{
    background: rgba(245,158,11,0.95);
    border: 2px solid #fbbf24;
    color: #fff;
    white-space: pre-wrap;
    animation: fadeout 12s forwards;
  }}
  @keyframes fadeout {{
    0% {{ opacity: 1; }}
    80% {{ opacity: 1; }}
    100% {{ opacity: 0; display: none; }}
  }}
</style>
<script>
  let sleepTimeout = null;
  const disableBlackout = {str(self.disable_blackout).lower()};

  function setBlackout(visible) {{
    if (disableBlackout) return;
    const b = document.getElementById("blackout");
    if (visible) {{
      b.style.display = "block";
    }} else {{
      b.style.display = "none";
      if (sleepTimeout) {{
        clearTimeout(sleepTimeout);
        sleepTimeout = null;
      }}
    }}
  }}

  function handleData(data, isInitial) {{
    const counts = data.counts || {{}};
    const total = counts.total ?? -1;

    // Wake up on any activity
    if (!isInitial) setBlackout(false);

    if (total === 0) {{
      // Building is empty — sleep after 5s delay (so user can see banner)
      if (!sleepTimeout) {{
        sleepTimeout = setTimeout(() => {{
          setBlackout(true);
        }}, isInitial ? 0 : 5000);
      }}
    }} else if (total > 0) {{
      setBlackout(false);
    }}
  }}

  function connectSSE() {{
    const source = new EventSource("/events");

    source.addEventListener("status", function(e) {{
      const data = JSON.parse(e.data);
      handleData(data, true);
    }});

    source.addEventListener("scan", function(e) {{
      const data = JSON.parse(e.data);
      if (data.reload) {{
        const iframe = document.querySelector("iframe");
        if (iframe) {{
          const u = new URL(iframe.src, window.location.origin);
          u.searchParams.set('_t', Date.now());
          iframe.src = u.toString();
        }}
        return;
      }}
      handleData(data, false);
      const html = data.html || "";
      if (html) {{
        const container = document.getElementById("flash-container");
        container.innerHTML = html;
        const banner = container.querySelector(".banner");
        if (banner) {{
          banner.style.animation = 'none';
          banner.offsetHeight;
          banner.style.animation = null;
        }}
        setTimeout(() => {{ container.innerHTML = ''; }}, 12000);
      }}
      // Tell iframe to refresh attendance display with inline data
      const iframe = document.querySelector("iframe");
      if (iframe && iframe.contentWindow) {{
        if (data.attendance) {{
          iframe.contentWindow.postMessage({{type: "refresh-attendance", attendance: data.attendance, counts: data.counts, safety: data.safety}}, "*");
        }} else {{
          iframe.contentWindow.postMessage("refresh-attendance", "*");
        }}
      }}
    }});
    source.onerror = function() {{
      source.close();
      setTimeout(connectSSE, 3000);
    }};
  }}
</script>
</head>
<body onload="connectSSE()">
  <div id="blackout"></div>
  <div id="flash-container"></div>
  <iframe src="{self.kiosk_path}"></iframe>
</body>
</html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def _serve_sse(self):
        """Server-Sent Events stream for pushing badge scan results to the browser."""
        import queue as queue_mod
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        q = self.state.subscribe()
        try:
            # Send initial status
            with self.state.lock:
                initial_status = json.dumps({"counts": self.state.current_counts})
            self.wfile.write(f"event: status\ndata: {initial_status}\n\n".encode())
            self.wfile.flush()

            while True:
                try:
                    # Wait up to 30s for an event, then send a keepalive comment
                    event_data = q.get(timeout=30)
                    payload = json.dumps(event_data)
                    self.wfile.write(f"event: scan\ndata: {payload}\n\n".encode())
                    self.wfile.flush()
                except queue_mod.Empty:
                    # Timeout — send keepalive to detect dead connections
                    try:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        break
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            self.state.unsubscribe(q)

    def _proxy_request(self, method):
        url = self.backend.base_url + self.path
        
        body_bytes = b""
        length = int(self.headers.get("Content-Length", 0))
        if length > 0:
            body_bytes = self.rfile.read(length)
            
        req_headers = {}
        for k, v in self.headers.items():
            if k.lower() not in ['host', 'connection', 'accept-encoding']:
                req_headers[k] = v
                
        # Inject Key Signing Headers onto the API requests transparently!
        # Sign with pathname only (no query string) — backend verifies against pathname
        from urllib.parse import urlparse
        sign_path = urlparse(self.path).path

        body_str = ""
        if body_bytes:
            try:
                body_str = body_bytes.decode('utf-8')
            except UnicodeDecodeError:
                pass
                
        sig_headers = sign_request(self.backend.signing_key, method, sign_path, body_str)
        req_headers.update(sig_headers)
        
        try:
            # Use requests.request (stateless) so cookies flow directly between browser and backend
            resp = requests.request(
                method=method,
                url=url,
                headers=req_headers,
                data=body_bytes if body_bytes else None,
                allow_redirects=False,
                stream=True,
                timeout=30
            )
            
            try:
                self.send_response(resp.status_code)
                for k, v in resp.headers.items():
                    if k.lower() not in ['transfer-encoding', 'connection', 'content-encoding']:
                        self.send_header(k, v)
                self.end_headers()
            except (BrokenPipeError, ConnectionResetError):
                return

            try:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                # Browser closed the connection, normal for HMR or page reloads
                pass
                    
        except Exception as e:
            if not isinstance(e, (BrokenPipeError, ConnectionResetError)):
                log.error(f"Proxy error for {self.path}: {e}")
            try:
                # If we haven't sent headers yet, try to send a 502
                self.send_response(502)
                self.end_headers()
            except:
                pass

    def log_message(self, format, *args):
        pass

# ---------------------------------------------------------------------------
# USB scanner listener
# ---------------------------------------------------------------------------
def usb_scanner_listener(backend, state, device_path):
    try:
        import evdev
    except ImportError:
        log.warning("evdev not installed — USB scanner disabled")
        return

    def find_device(pattern):
        import evdev
        devices = [evdev.InputDevice(path) for path in evdev.list_devices()]
        # 1. Try exact path match
        for d in devices:
            if d.path == pattern:
                return d
        # 2. Try name match (case-insensitive substring)
        for d in devices:
            if pattern.lower() in d.name.lower():
                log.info(f"Found device '{d.name}' at {d.path} matching pattern '{pattern}'")
                return d
        return None

    KEY_MAP = {
        2: "1", 3: "2", 4: "3", 5: "4", 6: "5",
        7: "6", 8: "7", 9: "8", 10: "9", 11: "0",
    }
    ENTER_KEY = 28

    log.info(f"Attempting to open USB device: {device_path}")
    try:
        dev = find_device(device_path)
        if not dev:
            # Fallback: if it's not found by name/path, but looks like a path, try opening it directly
            if device_path.startswith("/dev/input/"):
                import evdev
                dev = evdev.InputDevice(device_path)
            else:
                log.error(f"No device found matching: {device_path}")
                return
        
        dev.grab()
        log.info(f"Listening on: {dev.name} ({dev.path})")
    except Exception as e:
        log.error(f"Cannot open USB device {device_path}: {e}")
        return

    buffer = ""
    for event in dev.read_loop():
        if event.type != evdev.ecodes.EV_KEY:
            continue
        key_event = evdev.categorize(event)
        if key_event.keystate != 1:
            continue

        if key_event.scancode == ENTER_KEY:
            if buffer.strip():
                participant_id = buffer.strip()
                log.info(f"Scanned ID: {participant_id}")
                handle_scan(backend, state, participant_id)
            buffer = ""
        elif key_event.scancode in KEY_MAP:
            buffer += KEY_MAP[key_event.scancode]

def stdin_scanner_listener(backend, state):
    log.info("USB device not configured — reading scans from stdin")
    while True:
        try:
            line = input()
            participant_id = line.strip()
            if participant_id:
                log.info(f"Stdin scan: {participant_id}")
                handle_scan(backend, state, participant_id)
        except EOFError:
            break

def handle_scan(backend, state, participant_id):
    body, status = backend.post_scan(participant_id)

    # Build banner HTML for the wrapper page
    html = ""
    if status >= 400 or "error" in body:
        if body.get("type") == "warning":
            warn = body.get("error", "Warning").replace("\n", "<br>")
            html = f'<div class="banner banner-warning">⚠️ {warn}</div>'
        else:
            err = body.get("error", "Unknown error")
            html = f'<div class="banner banner-error">✗ Scan failed: {err}</div>'
    else:
        stype = body.get("type", "")
        email = body.get("participant", {}).get("email", "?")
        msg = body.get("message", "")
        label = "CHECKED IN" if stype == "checkin" else "CHECKED OUT"
        if msg and msg != "Checked in successfully" and msg != "Checked out successfully":
            html = f'<div class="banner banner-ok">✓ {email} — {msg}</div>'
        else:
            html = f'<div class="banner banner-ok">✓ {email} — {label}</div>'

    # Phase 1: Push banner immediately (no attendance data yet)
    state.push_event({"html": html})

    if status < 400 and "error" not in body:
        ptype = body.get("type", "?")
        email = body.get("participant", {}).get("email", "?")
        log.info(f"Scan result: {ptype.upper()} — {email}")
    else:
        log.warning(f"Scan error: {body.get('error', body)}")

    # Phase 2: Fetch fresh attendance and push update for the iframe
    if backend.attendance_path and status < 400:
        att_data, att_status = backend.get_attendance()
        if att_status == 200:
            event_payload = {"html": ""}
            for key in ("attendance", "counts", "safety"):
                if key in att_data:
                    event_payload[key] = att_data[key]
            if "counts" in att_data:
                with state.lock:
                    state.current_counts = att_data["counts"]
            state.push_event(event_payload)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def attendance_poller(backend, state, interval=30):
    """Background thread that polls attendance counts periodically.
    Pushes SSE status events when counts change so the blackout
    logic works on display-only kiosks without a scanner."""
    while True:
        time.sleep(interval)
        att_data, att_status = backend.get_attendance()
        if att_status == 200 and "counts" in att_data:
            new_counts = att_data["counts"]
            with state.lock:
                changed = new_counts != state.current_counts
                state.current_counts = new_counts
            if changed:
                log.info(f"Attendance poll: {new_counts.get('total', '?')} present")
                state.push_event({"html": "", "counts": new_counts})

def version_poller(backend, state, interval=60):
    """Background thread that checks for client and server version updates."""
    import subprocess
    
    # Get initial server version
    initial_server_version = None
    for _ in range(6):
        sv, status = backend.get_server_version()
        if status == 200 and sv:
            initial_server_version = sv
            log.info(f"Initial server version: {initial_server_version}")
            break
        time.sleep(5)
    
    while True:
        time.sleep(interval)
        
        # 1. Check Server Version Update
        if initial_server_version:
            sv, status = backend.get_server_version()
            if status == 200 and sv and sv != initial_server_version:
                log.info(f"Server version changed from {initial_server_version} to {sv}. Requesting reload.")
                state.push_event({"reload": True})
                initial_server_version = sv  # Update to prevent spam
        
        # 2. Check Client Version Update
        try:
            subprocess.run(["git", "fetch", "origin", "master"], capture_output=True, timeout=15)
            
            local_head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
            remote_head = subprocess.check_output(["git", "rev-parse", "origin/master"], text=True).strip()
            
            if local_head and remote_head and local_head != remote_head:
                log.info(f"Client version update available ({local_head} -> {remote_head}). Restarting client.")
                os._exit(0)
        except Exception as e:
            log.error(f"Error checking client version: {e}")

def main():
    config = load_config()
    backend_url = config["backend_url"]
    key_path = config.get("private_key_path", "./client.key")
    usb_device = config.get("usb_device", "")
    port = int(config.get("listen_port", 8080))
    kiosk_path = config.get("kiosk_path", "/kioskdisplay?mode=kiosk")
    attendance_path = config.get("attendance_path", "")
    disable_blackout = config.get("disable_blackout", True)

    log.info(f"Backend: {backend_url}")
    log.info(f"Key:     {key_path}")
    log.info(f"USB:     {usb_device or '(stdin fallback)'}")
    log.info(f"Port:    {port}")
    log.info(f"Path:    {kiosk_path}")
    log.info(f"Attendance: {attendance_path or '(disabled)'}")

    if not os.path.exists(key_path):
        log.error(f"Private key not found: {key_path}")
        sys.exit(1)
    signing_key = load_signing_key(key_path)

    backend = BackendClient(backend_url, signing_key, attendance_path or None)
    state = AttendanceState()

    # Fetch initial attendance state (only if attendance_path is configured)
    if attendance_path:
        log.info("Fetching initial attendance state...")
        att_data, att_status = backend.get_attendance()
        if att_status == 200 and "counts" in att_data:
            state.current_counts = att_data["counts"]
            log.info(f"Initial state: {state.current_counts['total']} people present")
        else:
            log.warning("Could not fetch initial attendance state")

        # Start background poller for blackout updates
        poller = threading.Thread(target=attendance_poller, args=(backend, state), daemon=True)
        poller.start()

    # Start version poller thread
    vpoller = threading.Thread(target=version_poller, args=(backend, state), daemon=True)
    vpoller.start()

    if usb_device:
        scanner = threading.Thread(target=usb_scanner_listener, args=(backend, state, usb_device), daemon=True)
    else:
        scanner = threading.Thread(target=stdin_scanner_listener, args=(backend, state), daemon=True)
    scanner.start()

    KioskHandler.state = state
    KioskHandler.backend = backend
    KioskHandler.kiosk_path = kiosk_path
    KioskHandler.disable_blackout = disable_blackout
    server = ThreadingHTTPServer(("0.0.0.0", port), KioskHandler)
    log.info(f"Proxy running on http://0.0.0.0:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")
        server.shutdown()

if __name__ == "__main__":
    main()
