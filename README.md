# @emmett-community/emmett-google-firestore

Google Firestore event store implementation for [Emmett](https://event-driven-io.github.io/emmett/), the Node.js event sourcing framework.

[![npm version](https://img.shields.io/npm/v/@emmett-community/emmett-google-firestore.svg)](https://www.npmjs.com/package/@emmett-community/emmett-google-firestore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- ✅ **Event Storage & Retrieval** - Store and read events from Google Firestore
- ✅ **Optimistic Concurrency** - Built-in version conflict detection
- ✅ **Type-Safe** - Full TypeScript support with comprehensive types
- ✅ **Minimal Boilerplate** - Simple, intuitive API
- ✅ **Subcollection-based** - Efficient Firestore-native structure (no size limits!)
- ✅ **Global Event Ordering** - Maintain total ordering across all streams
- ✅ **Testing Utilities** - Helper functions for easy testing
- ✅ **Emmett Compatible** - Works seamlessly with the Emmett ecosystem

## Installation

```bash
npm install @emmett-community/emmett-google-firestore @google-cloud/firestore
```

## Quick Start

```typescript
import { Firestore } from '@google-cloud/firestore';
import { getFirestoreEventStore } from '@emmett-community/emmett-google-firestore';

// Initialize Firestore
const firestore = new Firestore({
  projectId: 'your-project-id',
  keyFilename: 'path/to/service-account.json',
});

// Create event store
const eventStore = getFirestoreEventStore(firestore);

// Define your events
type UserRegistered = Event<'UserRegistered', { userId: string; email: string }>;
type UserEvent = UserRegistered | /* other events */;

// Append events
await eventStore.appendToStream('User-123', [
  {
    type: 'UserRegistered',
    data: { userId: '123', email: 'user@example.com' },
  },
]);

// Read events
const events = await eventStore.readStream<UserEvent>('User-123');

// Aggregate state
const state = await eventStore.aggregateStream(
  'User-123',
  evolve,
  initialState,
);
```

## How It Works

### Firestore Structure

Events are stored using a **subcollection pattern** for optimal performance:

```
/streams/                              # Root collection
  {streamName}/                        # Stream document (metadata)
    version: number
    createdAt: Timestamp
    updatedAt: Timestamp

    /events/                           # Subcollection (actual events)
      0000000000: { type, data, ... }  # Zero-padded version IDs
      0000000001: { type, data, ... }
      0000000002: { type, data, ... }

/_counters/                            # System collection
  global_position/
    value: number
```

**Benefits of this structure:**

- ✅ No document size limits (Firestore 1MB limit doesn't apply to subcollections)
- ✅ Natural isolation per stream
- ✅ Automatic ordering (document IDs sort naturally)
- ✅ No composite indexes needed (only `readByGlobalPosition` needs a collection group index, see its section)
- ✅ Efficient queries

### Optimistic Concurrency

The event store uses **optimistic locking** to prevent conflicts:

```typescript
// Append with version check
await eventStore.appendToStream(
  'User-123',
  events,
  { expectedStreamVersion: 5 }  // Will fail if version ≠ 5
);

// Or use special version markers
import { NO_STREAM, STREAM_EXISTS, ANY } from '@emmett-community/emmett-google-firestore';

// Stream must not exist
await eventStore.appendToStream('User-123', events, {
  expectedStreamVersion: NO_STREAM
});

// Stream must exist (any version)
await eventStore.appendToStream('User-123', events, {
  expectedStreamVersion: STREAM_EXISTS
});

// No version check
await eventStore.appendToStream('User-123', events, {
  expectedStreamVersion: ANY
});
```

## API Reference

### `getFirestoreEventStore(firestore, options?)`

Creates a Firestore event store instance.

**Parameters:**

- `firestore`: Firestore instance
- `options`: Optional configuration
  - `collections`: Custom collection names
    - `streams`: Stream collection name (default: `"streams"`)
    - `counters`: Counter collection name (default: `"_counters"`)
  - `hooks`: Extension points (see [Append hooks](#append-hooks))

**Returns:** `FirestoreEventStore`

```typescript
const eventStore = getFirestoreEventStore(firestore, {
  collections: {
    streams: 'my_streams',
    counters: 'my_counters',
  },
});
```

### Append hooks

`hooks.beforeCommit` runs inside the transaction of an append, after the events are written to it. It receives the transaction and the appended events, each with its `messageId`, stream and positions. What it writes on the transaction commits together with the events, and an error it throws aborts the append. This is how to keep something atomic with the events, such as a transactional outbox.

```typescript
const eventStore = getFirestoreEventStore(firestore, {
  hooks: {
    beforeCommit: (transaction, events) => {
      for (const event of events) {
        transaction.set(firestore.collection('audit').doc(event.messageId), { type: event.type });
      }
    },
  },
});
```

Firestore can run a transaction more than once when it conflicts, so the hook can run more than once for one append, with new ids each time. Only the writes of the attempt that commits are kept, so the hook must only write to the transaction, with no other side effect. It must not read, because Firestore rejects a read after a write in a transaction.

### `asEventStore(firestoreEventStore)`

Wraps a `FirestoreEventStore` instance in Emmett's `EventStore` interface so it can be passed into helpers that expect the canonical contract (CommandHandlers, workflows, etc.).

```typescript
const firestoreEventStore = getFirestoreEventStore(firestore);
const eventStore = asEventStore(firestoreEventStore);
```

### `eventStore.appendToStream(streamName, events, options?)`

Appends events to a stream.

**Parameters:**

- `streamName`: Stream identifier (e.g., `"User-123"`)
- `events`: Array of events to append
- `options`: Optional append options
  - `expectedStreamVersion`: Version constraint

**Returns:** `Promise<AppendToStreamResult>`, with `nextExpectedStreamVersion`, `createdNewStream` and `messageIds`, the `messageId` stored on each event, in the order of the events given.

```typescript
const result = await eventStore.appendToStream(
  'User-123',
  [{ type: 'UserRegistered', data: {...} }],
  { expectedStreamVersion: 0 }
);

console.log(result.nextExpectedStreamVersion); // 1
console.log(result.createdNewStream); // true/false
```

### `eventStore.readStream(streamName, options?)`

Reads events from a stream.

**Parameters:**

- `streamName`: Stream identifier
- `options`: Optional read options
  - `from`: Start version (inclusive)
  - `to`: End version (inclusive)
  - `maxCount`: Maximum number of events to read

**Returns:** `Promise<FirestoreReadEvent[]>`

```typescript
// Read all events
const events = await eventStore.readStream('User-123');

// Read from version 10 onwards
const events = await eventStore.readStream('User-123', { from: 10n });

// Read range
const events = await eventStore.readStream('User-123', {
  from: 5n,
  to: 10n
});

// Limit results
const events = await eventStore.readStream('User-123', {
  maxCount: 100
});
```

### `eventStore.readByGlobalPosition(options?)`

Reads events of every stream in global order.

**Parameters:**

- `options`: Optional read options
  - `after`: Return only events with a global position greater than this one (defaults to the start)
  - `maxCount`: Maximum number of events to read

```typescript
// Read every event of every stream
const all = await eventStore.readByGlobalPosition();

// Read what happened after a known position
const next = await eventStore.readByGlobalPosition({ after: 10n, maxCount: 100 });
```

**Required Firestore index:** this method runs a collection group query over `events` ordered by `globalPosition`, so a real Firestore project needs a collection group index on that field. Without it the query fails with `FAILED_PRECONDITION: The query requires an index`. The Firestore Emulator does not enforce indexes, so the error only shows up against a real project. Add this to your `firestore.indexes.json` and deploy it with `firebase deploy --only firestore:indexes`:

```json
{
  "indexes": [],
  "fieldOverrides": [
    {
      "collectionGroup": "events",
      "fieldPath": "globalPosition",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```

### `eventStore.aggregateStream(streamName, evolve, initialState, options?)`

Aggregates stream events into state.

**Parameters:**

- `streamName`: Stream identifier
- `evolve`: Function to apply events to state
- `initialState`: Function returning initial state
- `options`: Optional read options (same as `readStream`)

**Returns:** `Promise<State>`

```typescript
const state = await eventStore.aggregateStream(
  'User-123',
  (state, event) => {
    switch (event.type) {
      case 'UserRegistered':
        return { ...state, ...event.data };
      default:
        return state;
    }
  },
  () => ({ status: 'empty' }),
);
```

## Testing

### Running Tests

```bash
# Unit tests
npm run test:unit

# Integration tests (in-memory)
npm run test:int

# E2E tests (Firestore Emulator via Testcontainers, requires Docker)
npm run test:e2e

# All tests
npm test

# Coverage
npm run test:coverage
```

Test files live in `test/` and are selected by filename suffix:

- `*.unit.spec.ts` (unit tests, pure logic)
- `*.int.spec.ts` (integration tests, in-memory Firestore)
- `*.e2e.spec.ts` (E2E tests, Firestore emulator via Testcontainers)

Support fixtures live under `test/support` (including Firebase emulator configs in `test/support/firebase`).

### Using Firestore Emulator

For local development and manual testing:

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Start emulator
firebase emulators:start --only firestore
```

Set environment variables:

```bash
export FIRESTORE_PROJECT_ID=test-project
export FIRESTORE_EMULATOR_HOST=localhost:8080
```

E2E tests start the emulator automatically via Testcontainers.

## Examples

### Complete Shopping Cart Example

See [examples/shopping-cart](./examples/shopping-cart) for a full application including:

- Event-sourced shopping cart
- Express.js API with OpenAPI spec
- Docker Compose setup
- Unit, integration, and E2E tests

```bash
cd examples/shopping-cart
docker-compose up
```

### Basic Usage Example

```typescript
import { Firestore } from '@google-cloud/firestore';
import { getFirestoreEventStore } from '@emmett-community/emmett-google-firestore';
import type { Event } from '@event-driven-io/emmett';

// Define events
type AccountOpened = Event<'AccountOpened', {
  accountId: string;
  initialBalance: number;
}>;

type MoneyDeposited = Event<'MoneyDeposited', {
  accountId: string;
  amount: number;
}>;

type BankAccountEvent = AccountOpened | MoneyDeposited;

// Define state
type BankAccount = {
  accountId: string;
  balance: number;
  status: 'open' | 'closed';
};

// Evolve function
const evolve = (state: BankAccount, event: BankAccountEvent): BankAccount => {
  switch (event.type) {
    case 'AccountOpened':
      return {
        accountId: event.data.accountId,
        balance: event.data.initialBalance,
        status: 'open',
      };
    case 'MoneyDeposited':
      return {
        ...state,
        balance: state.balance + event.data.amount,
      };
    default:
      return state;
  }
};

const initialState = (): BankAccount => ({
  accountId: '',
  balance: 0,
  status: 'closed',
});

// Usage
const firestore = new Firestore({ projectId: 'my-project' });
const eventStore = getFirestoreEventStore(firestore);

// Open account
await eventStore.appendToStream('BankAccount-123', [
  {
    type: 'AccountOpened',
    data: { accountId: '123', initialBalance: 100 }
  },
]);

// Deposit money
await eventStore.appendToStream('BankAccount-123', [
  {
    type: 'MoneyDeposited',
    data: { accountId: '123', amount: 50 }
  },
]);

// Get current state
const account = await eventStore.aggregateStream(
  'BankAccount-123',
  evolve,
  initialState,
);

console.log(account.balance); // 150
```

## Configuration

### Custom Collection Names

```typescript
const eventStore = getFirestoreEventStore(firestore, {
  collections: {
    streams: 'app_streams',
    counters: 'app_counters',
  },
});
```

### Firestore Emulator (Development)

```typescript
const firestore = new Firestore({
  projectId: 'demo-project',
  host: 'localhost:8080',
  ssl: false,
});
```

### Production Configuration

```typescript
const firestore = new Firestore({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: process.env.GCP_KEY_FILE,
  // Optional: specify database
  databaseId: '(default)',
});
```

## Architecture

### Event Sourcing Pattern

This package implements the **Event Sourcing** pattern:

1. **Commands** → Validate and create events
2. **Events** → Immutable facts that happened
3. **State** → Rebuilt by replaying events

```
Command → Decide → Events → Append to Firestore → Evolve → State
```

### Firestore Transaction Flow

When appending events, the following happens atomically:

1. Read current stream version
2. Validate expected version
3. Increment global position counter
4. Append events to subcollection
5. Update stream metadata
6. Commit transaction

If any step fails or versions don't match, the entire transaction is rolled back.

## Performance Considerations

### Batch Size

Firestore transactions are limited to 500 operations. When appending many events:

```typescript
// Good: Small batches
await eventStore.appendToStream('stream', events.slice(0, 100));

// Avoid: Very large batches (>400 events)
```

### Query Optimization

```typescript
// Good: Use range queries
const recent = await eventStore.readStream('stream', {
  from: lastKnownVersion,
});

// Good: Limit results
const events = await eventStore.readStream('stream', {
  maxCount: 100
});
```

### Firestore Costs

- **Reads**: Each document read counts (events + metadata)
- **Writes**: Each event appended counts
- **Storage**: Charged per GB stored

Use the emulator for development to avoid costs!

## Error Handling

```typescript
import { ExpectedVersionConflictError } from '@emmett-community/emmett-google-firestore';

try {
  await eventStore.appendToStream('stream', events, {
    expectedStreamVersion: 5
  });
} catch (error) {
  if (error instanceof ExpectedVersionConflictError) {
    console.log('Version conflict:', error.expected, 'vs', error.actual);
    // Handle conflict (retry, merge, etc.)
  }
}
```

## Observability

The event store supports optional logging and OpenTelemetry tracing.

### Logging

Pass an optional logger compatible with Pino:

```typescript
import pino from 'pino';

const eventStore = getFirestoreEventStore(firestore, {
  observability: {
    logger: pino({ level: 'debug' }),
  },
});
```

**Logging points:**

- `info`: Initialization
- `debug`: I/O operations (queries, transactions)
- `warn`: Version conflicts (recoverable)
- `error`: Failures before rethrowing

**Note:** Event payloads are never logged.

### Tracing

The package uses `@opentelemetry/api` directly. Spans are created passively:

- If your application initializes OpenTelemetry, spans will be recorded
- If not, the tracing calls are no-ops with zero overhead

**Span names:**

- `emmett.firestore.read_stream`
- `emmett.firestore.append_to_stream`

**Attributes:**

- `emmett.stream_name`
- `emmett.event_count`
- `emmett.new_version`
- `emmett.created_new_stream`

To enable tracing, initialize OpenTelemetry in your application (this package never initializes tracing itself).

## TypeScript Support

The package is written in TypeScript and includes full type definitions:

```typescript
import type {
  FirestoreEventStore,
  FirestoreReadEvent,
  AppendToStreamOptions,
  ExpectedStreamVersion,
} from '@emmett-community/emmett-google-firestore';
```

## Compatibility

- **Node.js**: >= 18.0.0
- **Emmett**: ^0.39.0
- **Firestore**: ^7.10.0

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT © Emmett Community

## Resources

- [Emmett Documentation](https://event-driven-io.github.io/emmett/)
- [Event Sourcing Guide](https://event-driven.io/en/event_sourcing_basics/)
- [Google Firestore Docs](https://cloud.google.com/firestore/docs)
- [GitHub Repository](https://github.com/emmett-community/emmett-google-firestore)

## Support

- **Issues**: [GitHub Issues](https://github.com/emmett-community/emmett-google-firestore/issues)
- **Discussions**: [GitHub Discussions](https://github.com/emmett-community/emmett-google-firestore/discussions)
- **Emmett Discord**: [Join Discord](https://discord.gg/fTpqUTMmVa)

## Acknowledgments

- Built for the [Emmett](https://event-driven-io.github.io/emmett/) framework by [Oskar Dudycz](https://github.com/oskardudycz)
- Inspired by [emmett-mongodb](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-mongodb)
- Part of the [Emmett Community](https://github.com/emmett-community)

---

Made with ❤️ by the Emmett Community