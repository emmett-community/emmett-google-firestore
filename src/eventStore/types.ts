import type { Firestore, Timestamp } from '@google-cloud/firestore';
import type { Event, ReadEvent, ReadEventMetadataWithGlobalPosition } from '@event-driven-io/emmett';
import {
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  NO_CONCURRENCY_CHECK,
  type ExpectedStreamVersion as EmmettExpectedStreamVersion,
} from '@event-driven-io/emmett';

/**
 * Minimal logger interface compatible with Pino and other loggers.
 * All methods are optional to support varying logger implementations.
 */
export interface Logger {
  debug?(msg: string, data?: unknown): void;
  info?(msg: string, data?: unknown): void;
  warn?(msg: string, data?: unknown): void;
  error?(msg: string, err?: unknown): void;
}

/**
 * Observability configuration options
 */
export interface ObservabilityOptions {
  /** Optional logger instance. If not provided, no logging occurs. */
  logger?: Logger;
}

/**
 * Expected version for stream operations
 * Uses Emmett's standard version constants for full compatibility
 * - number | bigint: Expect specific version
 * - STREAM_DOES_NOT_EXIST: Stream must not exist
 * - STREAM_EXISTS: Stream must exist (any version)
 * - NO_CONCURRENCY_CHECK: No version check
 */
export type ExpectedStreamVersion = EmmettExpectedStreamVersion<bigint>;

// Re-export Emmett constants for convenience
export { STREAM_DOES_NOT_EXIST, STREAM_EXISTS, NO_CONCURRENCY_CHECK };

/**
 * Options for appending events to a stream
 */
export interface AppendToStreamOptions {
  expectedStreamVersion?: ExpectedStreamVersion;
}

/**
 * Result of appending events to a stream
 */
export interface AppendToStreamResult {
  nextExpectedStreamVersion: bigint;
  createdNewStream: boolean;
}

/**
 * Options for reading events from a stream
 */
export interface ReadStreamOptions {
  from?: bigint;
  to?: bigint;
  maxCount?: number;
}

/**
 * Metadata stored in Firestore stream document
 */
export interface StreamMetadata {
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Event document structure in Firestore
 */
export interface EventDocument {
  type: string;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  timestamp: Timestamp;
  globalPosition: number;
  streamVersion: number;
}

/**
 * Firestore-specific read event metadata
 */
export interface FirestoreReadEventMetadata extends ReadEventMetadataWithGlobalPosition {
  streamName: string;
  streamVersion: bigint;
  timestamp: Date;
}

/**
 * Firestore read event
 */
export type FirestoreReadEvent<EventType extends Event = Event> = ReadEvent<
  EventType,
  FirestoreReadEventMetadata
>;

/**
 * Collection configuration for Firestore event store
 */
export interface CollectionConfig {
  streams: string;
  counters: string;
}

/**
 * Firestore event store options
 */
export interface FirestoreEventStoreOptions {
  collections?: Partial<CollectionConfig>;
  observability?: ObservabilityOptions;
}

/**
 * Firestore event store interface
 */
export interface FirestoreEventStore {
  /**
   * The underlying Firestore instance
   */
  readonly firestore: Firestore;

  /**
   * Collection names configuration
   */
  readonly collections: CollectionConfig;

  /**
   * Read events from a stream
   */
  readStream<EventType extends Event>(
    streamName: string,
    options?: ReadStreamOptions,
  ): Promise<FirestoreReadEvent<EventType>[]>;

  /**
   * Aggregate stream by applying events to state
   */
  aggregateStream<State, EventType extends Event>(
    streamName: string,
    options: {
      evolve: (state: State, event: FirestoreReadEvent<EventType>) => State;
      initialState: () => State;
      read?: ReadStreamOptions;
    },
  ): Promise<{
    state: State;
    currentStreamVersion: bigint;
    streamExists: boolean;
  }>;

  /**
   * Append events to a stream
   */
  appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions,
  ): Promise<AppendToStreamResult>;
}

/**
 * Error thrown when expected version doesn't match current version
 */
export class ExpectedVersionConflictError extends Error {
  constructor(
    public readonly streamName: string,
    public readonly expected: ExpectedStreamVersion,
    public readonly actual: bigint | typeof STREAM_DOES_NOT_EXIST,
  ) {
    super(
      `Expected version conflict for stream '${streamName}': expected ${String(expected)}, actual ${String(actual)}`,
    );
    this.name = 'ExpectedVersionConflictError';
    Object.setPrototypeOf(this, ExpectedVersionConflictError.prototype);
  }
}
