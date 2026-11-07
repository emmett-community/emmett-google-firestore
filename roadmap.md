# Roadmap

Work planned for this library, driven by the rules of the my-f-startup reference architecture (eventing and read models: ADR-003, ADR-007, ADR-010). All changes must be backward compatible. Status was checked against the code of version 0.7.0.

Legend: Done, Partial, Open.

| Item | Status | Evidence and note |
|---|---|---|
| Set `messageId` (a UUID) on every appended event and return it in the read metadata | Done | Written by `appendToStreamInTransaction` and returned by `readStream` and `readByGlobalPosition`; events written earlier get the derived id `<streamName>:<streamVersion>` (0.6.0) |
| Store the event `metadata` as given | Done | The append stores `metadata` when present and the read spreads it into the read metadata (`src/eventstore/firestoreeventstore.ts`) |
| Version conflict error is a proper concurrency error with a status code | Partial | `ExpectedVersionConflictError` now has `statusCode` and `errorCode` 412 (`src/eventstore/types.ts`). Still extends `Error`, not Emmett's own concurrency error; spike S3 checks the end-to-end behavior and whether the core retry applies |
| Collection names, including counters, configurable per service | Done | `CollectionConfig` (`streams`, `counters`) through `FirestoreEventStoreOptions.collections` |
| Read by global position, with its index | Done | `readByGlobalPosition` plus the collection group index on `events.globalPosition`, documented in the README (0.6.0). Covered by the e2e suite on the Firestore emulator, which does not enforce indexes, so the index itself is not yet verified against a real Firestore project |
| `/testing` entry with the in-memory Firestore fake | Done | `InMemoryFirestore` in `src/testing`, exported as `/testing` (0.6.0) |
| Hook inside the transaction of an append, and `messageId` returned by the append | Done | `hooks.beforeCommit` and `messageIds` (0.7.0). Generic: the transactional outbox of ADR-003 uses it from its own library |
| Asynchronous projection runner (see below) | Open | Location is to be decided |

## Asynchronous projections

The architecture needs a runner that follows the event store in global order, applies events to read models in Firestore and the Realtime Database, keeps a checkpoint per projection, is idempotent and can be reset to rebuild (ADR-007). It may live in this library, in the Realtime Database projection library or in a new one. The decision is open and depends on spike S10: how do Emmett's consumer and asynchronous projection mechanisms fit this event store (read by global position, checkpoints, rebuild, running continuously or on a schedule)?

## Open questions

- Spike S3: what does a concurrent write do today, end to end?
