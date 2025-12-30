# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.0]: https://github.com/emmett-community/emmett-google-firestore/releases/tag/0.3.0
[0.2.0]: https://github.com/emmett-community/emmett-google-firestore/releases/tag/0.2.0
[0.1.0]: https://github.com/emmett-community/emmett-google-firestore/releases/tag/0.1.0
