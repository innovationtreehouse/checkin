#!/bin/bash
# reload.sh — Reload the application on bare metal AWS instance

set -e

APP_DIR="/home/ubuntu/checkmein"
cd $APP_DIR

echo "--- Pulling latest code ---"
git pull

echo "--- Installing dependencies (workspace root) ---"
npm install

echo "--- Syncing Database Schema ---"
npm -w checkin-app exec -- prisma db push

echo "--- Generating Prisma client ---"
npm -w checkin-app exec -- prisma generate

echo "--- Building application ---"
npm -w checkin-app run build

echo "--- Cleaning up dev dependencies ---"
npm prune --omit=dev

echo "--- Restarting application service ---"
# If using systemd:
if systemctl is-active --quiet checkmein; then
    sudo systemctl restart checkmein
    echo "✓ Application restarted via systemctl"
else
    # Fallback: kill existing node server.js and start anew
    echo "Using manual fallback restart..."
    PID=$(pgrep -f "node checkin-app/.next/standalone/checkin-app/server.js")
    if [ -n "$PID" ]; then
        kill $PID
        sleep 2
    fi
    # Standalone tracing roots at the repo, so the server entrypoint is nested
    # under checkin-app/ (workspace layout): checkin-app/.next/standalone/checkin-app/server.js
    nohup node checkin-app/.next/standalone/checkin-app/server.js > .production_server.log 2>&1 &
    echo "✓ Application restarted in background (PID: $!)"
fi

echo "Done!"
