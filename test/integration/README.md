# Integration Tests

Integration tests for the Firestore Event Store that run against the Firestore Emulator.

## Prerequisites

### Install Firebase CLI

The integration tests require the Firestore Emulator, which is part of the Firebase CLI.

```bash
# Install Firebase CLI globally
npm install -g firebase-tools

# Install Firestore Emulator
firebase setup:emulators:firestore
```

Alternatively, you can use the Google Cloud SDK:

```bash
# Install gcloud CLI
# Then install the Firestore emulator
gcloud components install cloud-firestore-emulator
```

## Running Integration Tests

### Option 1: Manual Emulator Start

1. Start the Firestore emulator in a separate terminal:

```bash
# Using the provided script
./scripts/start-emulator.sh

# Or manually
firebase emulators:start --only firestore

# Or with gcloud
gcloud emulators firestore start --host-port=localhost:8080
```

2. Run the integration tests:

```bash
npm run test:integration
```

3. Stop the emulator when done:

```bash
# Using the provided script
./scripts/stop-emulator.sh

# Or press Ctrl+C in the emulator terminal
```

### Option 2: Docker (Coming Soon)

A Docker Compose setup for running tests will be available in Phase 6.

## Environment Variables

The tests use the following environment variables:

- `FIRESTORE_PROJECT_ID`: Project ID for the emulator (default: `test-project`)
- `FIRESTORE_EMULATOR_HOST`: Emulator host and port (default: `localhost:8080`)

You can override these:

```bash
FIRESTORE_PROJECT_ID=my-test-project npm run test:integration
```

## Test Coverage

The integration tests cover:

- ✅ Appending events to streams
- ✅ Reading events from streams
- ✅ Aggregating stream state
- ✅ Optimistic concurrency control
- ✅ Global position assignment
- ✅ Stream versioning
- ✅ Range queries (from/to/maxCount)
- ✅ Concurrent operations
- ✅ Version conflict detection

## Troubleshooting

### Emulator not running

If tests fail with connection errors, make sure the Firestore emulator is running:

```bash
# Check if emulator is running
curl http://localhost:8080

# Should return Firestore emulator info
```

### Port already in use

If port 8080 is already in use, you can change the emulator port:

```bash
# Start emulator on different port
firebase emulators:start --only firestore --port 9000

# Run tests with custom port
FIRESTORE_EMULATOR_HOST=localhost:9000 npm run test:integration
```

### Tests hanging

If tests hang, the emulator might not be properly configured. Try:

1. Stop all emulator instances
2. Clear emulator data: `rm -rf ~/.config/firebase/emulators`
3. Restart the emulator
4. Run tests again

## CI/CD Integration

For CI/CD pipelines, you can use GitHub Actions or similar:

```yaml
# Example GitHub Actions workflow
- name: Install Firebase CLI
  run: npm install -g firebase-tools

- name: Start Firestore Emulator
  run: firebase emulators:start --only firestore &

- name: Wait for Emulator
  run: sleep 5

- name: Run Integration Tests
  run: npm run test:integration
```
