#!/usr/bin/env bash
# CheckMeIn Kiosk — start script for Raspberry Pi
# Run this from the checkin-client directory.
set -e

# Ensure we're in the script's directory
cd "$(dirname "$0")"

while true; do
  echo "Pulling latest changes from git..."
  git pull origin master || true

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

  $CHROME \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --no-first-run \
    --disable-session-crashed-bubble \
    --password-store=basic \
    "http://localhost:${PORT}" &
  CHROME_PID=$!

  # If the client dies (e.g. self-update), kill the browser and loop
  wait $CLIENT_PID
  echo "Client died, restarting kiosk loop..."
  kill $CHROME_PID || true
  sleep 2
done
