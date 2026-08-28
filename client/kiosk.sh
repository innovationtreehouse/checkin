#!/usr/bin/env bash
# CheckMeIn Kiosk — start script for Raspberry Pi
# Run this from the client/ directory of the checkin monorepo.
set -e

# Ensure we're in the script's directory
cd "$(dirname "$0")"

while true; do
  echo "Pulling latest changes from git..."
  # Pull from the monorepo root: this script lives in client/ inside the
  # `checkin` monorepo, so .git is one level up. -C makes the target explicit.
  # A failed pull can't kill the kiosk under `set -e`, so log loudly instead
  # of swallowing it -- client.py's loop guard needs this checkout fixed.
  if ! git -C "$(git rev-parse --show-toplevel)" pull origin main; then
    echo "WARNING: git pull failed -- kiosk will keep running the current checkout." >&2
  fi

  # Start the client backend
  echo "Starting kiosk client..."
  python3 client.py &
  CLIENT_PID=$!

  # Wait for the server to come up
  sleep 2

  # Open Chromium in kiosk mode
  PORT=$(python3 -c "import json; print(json.load(open('config.json')).get('listen_port', 8080))")
  echo "Opening kiosk browser on port $PORT"

  # Disable X11 screen blanking and power management (DPMS) so the screen stays on
  xset s noblank || true
  xset s off || true
  xset -dpms || true

  # Newer Pi OS uses 'chromium', older uses 'chromium-browser'
  if command -v chromium-browser &>/dev/null; then
    CHROME=chromium-browser
  elif command -v chromium &>/dev/null; then
    CHROME=chromium
  else
    echo "ERROR: No Chromium browser found" >&2
    exit 1
  fi

  start_chrome() {
    $CHROME \
      --kiosk \
      --noerrdialogs \
      --disable-infobars \
      --no-first-run \
      --disable-session-crashed-bubble \
      --password-store=basic \
      "http://localhost:${PORT}" &
    CHROME_PID=$!
  }

  rm -f .chromium-bounce
  start_chrome

  # Inner loop: bounce Chromium alone when client.py writes the sentinel.
  # os._exit(0) still kills CLIENT_PID and takes the outer cycle.
  while kill -0 "$CLIENT_PID" 2>/dev/null; do
    if [ -f .chromium-bounce ]; then
      rm -f .chromium-bounce
      echo "Chromium bounce requested"
      kill "$CHROME_PID" 2>/dev/null || true
      wait "$CHROME_PID" 2>/dev/null || true
      start_chrome
    fi
    sleep 2
  done
  echo "Client died, restarting kiosk loop..."
  kill "$CHROME_PID" 2>/dev/null || true
  wait "$CHROME_PID" 2>/dev/null || true
  sleep 2
done
