# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - Unreleased

### Added

- `messageId` (a UUID) is stored on every appended event and returned in the read metadata. Events written before this release get a stable derived id (`<streamName>:<streamVersion>`).
- `readByGlobalPosition({ after, maxCount })` reads events of every stream in global order, backed by a collection group index on `events.globalPosition` (the index definition is in the README).
- `ExpectedVersionConflictError` carries `statusCode` and `errorCode` 412 so an HTTP layer can map it.
- `@emmett-community/emmett-google-firestore/testing` entry exporting `InMemoryFirestore`, now with `collectionGroup` support.

## [0.5.0] - 2026-01-15

### Added

- `asEventStore` helper to expose a `FirestoreEventStore` instance as an `@event-driven-io/emmett` `EventStore` so downstream helpers get the canonical interface.
- Updated shopping cart example and tests to build against the adaptor and demonstrate wiring through Emmett helpers (`examples/shopping-cart/src/index.ts`, `examples/shopping-cart/test/handlers.*.spec.ts`).

### Changed

- Re-aligned `ReadStreamOptions` with the existing public contract and kept the Firestore implementation compatible while normalizing bigint-friendly options for internal use, avoiding breaking changes for existing apps.
- Documented the new helper in the README and fixed the `maxCount` usage in the E2E test so tooling validates cleanly.

## [0.4.0] - 2025-12-31

### Changed

- Logger interface now uses `(context, message)` signature instead of `(message, data)`
- Logger contract is now formally defined and library-agnostic (compatible with Pino, Winston, etc.)
- Logger methods are now required (not optional)
- Error objects must use the `'err'` key (Pino compatibility)
- Added `normalizeContext` and `normalizeErrorContext` internal helpers
- Refactored `safeLog` to object pattern for ergonomic internal usage

### Added

- Comprehensive Logger contract tests (`logger-contract.unit.spec.ts`)
- JSDoc documentation with "DO NOT MODIFY" warning for ecosystem stability
- Winston adapter pattern example in documentation

## [0.3.0] - 2025-12-30

### Added

- Observability hooks: optional logging and OpenTelemetry tracing in the Firestore event store
- Exported `Logger` and `ObservabilityOptions` types
- Unit tests covering observability behavior

### Changed

- Added optional peer dependency on `@opentelemetry/api`
- Shopping cart example now uses `@emmett-community/emmett-expressjs-with-openapi@0.3.0`
- README expanded with observability documentation

## [0.2.0] - 2025-12-26

### Added

- GitHub Actions workflows for build/test and publish
- Firestore emulator E2E tests for the shopping cart example (Testcontainers)
- In-memory Firestore test utilities and fixtures

### Changed

- Reorganized unit, integration, and E2E tests across the package and example

### Removed

- Legacy emulator start/stop scripts

## [0.1.0] - 2025-12-14

### Added

- Initial implementation of Firestore event store
- Support for event appending with optimistic concurrency
- Support for event reading and stream aggregation
- TypeScript type definitions
- Unit, integration, and E2E tests
- Shopping cart example application
- Documentation

[0.5.0]: https://github.com/emmett-community/emmett-google-firestore/releases/tag/0.5.0
[0.4.0]: https://github.com/emmett-community/emmett-google-firestore/releases/tag/0.4.0
[0.3.0]: https://github.com/emmett-community/emmett-google-firestore/releases/tag/0.3.0
[0.2.0]: https://github.com/emmett-community/emmett-google-firestore/releases/tag/0.2.0
[0.1.0]: https://github.com/emmett-community/emmett-google-firestore/releases/tag/0.1.0
