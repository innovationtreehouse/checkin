#!/bin/bash
# reload.sh — Reload the application on bare metal AWS instance

set -e

APP_DIR="/home/ubuntu/checkmein"
cd $APP_DIR

echo "--- Pulling latest code ---"
git pull

echo "--- Installing dependencies ---"
npm install

echo "--- Generating Prisma client ---"
npx prisma generate

echo "--- Building application ---"
npm run build

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
    PID=$(pgrep -f "node .next/standalone/server.js")
    if [ -n "$PID" ]; then
        kill $PID
        sleep 2
    fi
    # Start the standalone server from the root
    nohup node .next/standalone/server.js > .production_server.log 2>&1 &
    echo "✓ Application restarted in background (PID: $!)"
fi

echo "Done!"
