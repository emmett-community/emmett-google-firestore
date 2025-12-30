// Main EventStore exports
export { getFirestoreEventStore } from './firestoreEventStore';

// Types and interfaces
export type {
  FirestoreEventStore,
  FirestoreEventStoreOptions,
  FirestoreReadEvent,
  FirestoreReadEventMetadata,
  AppendToStreamOptions,
  AppendToStreamResult,
  ReadStreamOptions,
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
