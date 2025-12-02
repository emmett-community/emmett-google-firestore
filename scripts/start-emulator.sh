#!/bin/bash

# Start Firestore Emulator for local development
# Requires: gcloud CLI with firestore emulator installed
#
# Installation:
#   gcloud components install cloud-firestore-emulator
#
# Usage:
#   ./scripts/start-emulator.sh

set -e

PROJECT_ID=${FIRESTORE_PROJECT_ID:-"demo-project"}
HOST=${FIRESTORE_EMULATOR_HOST:-"localhost:8080"}

echo "Starting Firestore Emulator..."
echo "Project ID: $PROJECT_ID"
echo "Host: $HOST"
echo ""
echo "To connect your application, set:"
echo "  export FIRESTORE_EMULATOR_HOST=$HOST"
echo "  export FIRESTORE_PROJECT_ID=$PROJECT_ID"
echo ""

gcloud emulators firestore start \
  --project="$PROJECT_ID" \
  --host-port="$HOST"
