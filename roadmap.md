# Roadmap

Work planned for this library. All changes must be backward compatible. Status was checked against the code of version 0.8.1.

Legend: Done, Partial, Open.

| Item | Status | Evidence and note |
|---|---|---|
| Set `messageId` (a UUID) on every appended event and return it in the read metadata | Done | Written by `appendToStreamInTransaction` and returned by `readStream` and `readByGlobalPosition`; events written earlier get the derived id `<streamName>:<streamVersion>` (0.6.0) |
| Store the event `metadata` as given | Done | The append stores `metadata` when present and the read spreads it into the read metadata (`src/eventstore/firestoreeventstore.ts`) |
| Version conflict error is a proper concurrency error with a status code | Done | `ExpectedVersionConflictError` has `statusCode` and `errorCode` 412 (`src/eventstore/types.ts`). It extends `Error`, not Emmett's own concurrency error, but Emmett's `isExpectedVersionConflictError` recognizes it by the error code, so the command handler with `retry: { onVersionConflict: true }` decides the command again (test `version-conflict-retry.int.spec.ts`, 0.8.1) |
| Collection names, including counters, configurable per service | Done | `CollectionConfig` (`streams`, `counters`) through `FirestoreEventStoreOptions.collections` |
| Read by global position, with its index | Done | `readByGlobalPosition` plus the collection group index on `events.globalPosition`, documented in the README (0.6.0). Covered by the e2e suite on the Firestore emulator, which does not enforce indexes, so the index itself is not yet verified against a real Firestore project |
| `/testing` entry with the in-memory Firestore fake | Done | `InMemoryFirestore` in `src/testing`, exported as `/testing` (0.6.0) |
| Hook inside the transaction of an append, and `messageId` returned by the append | Done | `hooks.beforeCommit` and `messageIds` (0.7.0). Generic: it lets a caller keep writes atomic with the events, such as a transactional outbox |
| Hook for one append only | Done | `beforeCommit` option of `appendToStream`, run after the store hook (0.8.0). Generic: it lets a caller keep a write atomic with one append, such as the record of an inbox. The in-memory fake gains `create` and `delete` in transactions, with the `ALREADY_EXISTS` failure of `create` |
| Asynchronous projection runner (see below) | Open | Location is to be decided |
| Lint and format check in CI | Done | `build_and_test` runs `npm run lint` and `npm run format:check` before the build (0.8.1) |
| Spans of the Firestore client under the event store spans | Done | The operation span is active while the store calls Firestore (0.8.1), covered by unit tests with an OpenTelemetry SDK registered |

## Asynchronous projections

An asynchronous projection runner would follow the event store in global order (`readByGlobalPosition`), apply events to read models, keep a checkpoint per projection, be idempotent and be reset to rebuild. Where it lives is not decided. It depends on how Emmett's consumer and asynchronous projection mechanisms fit this event store (read by global position, checkpoints, rebuild, running continuously or on a schedule).
