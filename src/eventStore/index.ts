// Main EventStore exports
export { getFirestoreEventStore, asEventStore } from './firestoreEventStore';

// Types and interfaces
export type {
  FirestoreEventStore,
  FirestoreEventStoreHooks,
  FirestoreEventStoreOptions,
  FirestoreReadEvent,
  FirestoreReadEventMetadata,
  AppendToStreamOptions,
  AppendToStreamResult,
  AppendedEvent,
  BeforeCommitHook,
  ReadStreamOptions,
  ReadByGlobalPositionOptions,
  ExpectedStreamVersion,
  CollectionConfig,
  StreamMetadata,
  EventDocument,
  Logger,
  ObservabilityOptions,
} from './types';

export {
  ExpectedVersionConflictError,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  NO_CONCURRENCY_CHECK,
} from './types';

// Utility functions (exported for advanced use cases and testing)
export {
  padVersion,
  parseStreamName,
  timestampToDate,
  assertExpectedVersionMatchesCurrent,
  getCurrentStreamVersion,
  calculateNextVersion,
} from './utils';
