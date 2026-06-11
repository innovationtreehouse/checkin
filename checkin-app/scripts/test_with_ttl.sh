#!/bin/bash
# Wrapper to run next dev with a timeout to avoid hung background ports

TIMEOUT=30
echo "Starting Next.js with a ${TIMEOUT}s TTL..."

# Start Next.js in the background
npm run dev &
NEXT_PID=$!

# Wait for 5 seconds to let it boot
sleep 5

# Run the provided command (like our mock scanner)
eval "$@"

# Wait for the remaining TTL and then kill the specific Next.js child process
REMAINING=$((TIMEOUT - 5))
echo "Tests run. Waiting ${REMAINING}s before killing Next.js (PID: ${NEXT_PID})..."
sleep $REMAINING

kill $NEXT_PID
echo "Next.js dev server killed."
