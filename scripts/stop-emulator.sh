#!/bin/bash

# Stop Firestore Emulator
# Finds and kills the Firestore emulator process

set -e

echo "Stopping Firestore Emulator..."

# Find and kill the emulator process
PID=$(pgrep -f "cloud-firestore-emulator" || true)

if [ -z "$PID" ]; then
  echo "Firestore Emulator is not running"
  exit 0
fi

echo "Found Firestore Emulator process: $PID"
kill "$PID"

echo "Firestore Emulator stopped"
