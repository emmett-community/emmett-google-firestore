import { randomUUID } from 'node:crypto';
import type {
  Firestore,
  Transaction,
  Timestamp,
} from '@google-cloud/firestore';
import type {
  AggregateStreamOptions,
  AggregateStreamResult,
  Event,
  EventStore,
  ReadStreamOptions as EmmettReadStreamOptions,
  ReadStreamResult,
} from '@event-driven-io/emmett';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type {
  AppendToStreamOptions,
  AppendToStreamResult,
  AppendedEvent,
  BeforeCommitHook,
  CollectionConfig,
  EventDocument,
  ExpectedStreamVersion,
  FirestoreEventStore,
  FirestoreEventStoreHooks,
  FirestoreEventStoreOptions,
  FirestoreReadEvent,
  FirestoreReadEventMetadata,
  Logger,
  ReadByGlobalPositionOptions,
  ReadStreamOptions,
  StreamMetadata,
} from './types';
import {
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  ExpectedVersionConflictError,
} from './types';
import {
  assertExpectedVersionMatchesCurrent,
  getCurrentStreamVersion,
  padVersion,
  timestampToDate,
} from './utils';

const tracer = trace.getTracer('@emmett-community/emmett-google-firestore');

/**
 * @internal - NOT part of public API
 * Normalizes data to a context object for the Logger contract.
 */
function normalizeContext(data: unknown): Record<string, unknown> {
  if (data === undefined || data === null) return {};
  if (typeof data === 'object' && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>) };
  }
  return { data };
}

/**
 * @internal - NOT part of public API
 * Normalizes error data to a context object for the Logger contract.
 * Uses 'err' key for Error instances (Pino compatibility).
 */
function normalizeErrorContext(error: unknown): Record<string, unknown> {
  if (error === undefined || error === null) return {};
  if (error instanceof Error) {
    return { err: error };
  }
  if (typeof error === 'object' && !Array.isArray(error)) {
    return { ...(error as Record<string, unknown>) };
  }
  return { err: error };
}

/**
 * @internal - NOT part of public API
 *
 * Internal helper for ergonomic logging within this package.
 * Translates internal (msg, data) calls to canonical (context, message) contract.
 *
 * This is the ONLY point where translation from internal format to contract format occurs.
 */
const safeLog = {
  debug: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.debug(normalizeContext(data), msg);
  },
  info: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.info(normalizeContext(data), msg);
  },
  warn: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.warn(normalizeContext(data), msg);
  },
  error: (logger: Logger | undefined, msg: string, error?: unknown): void => {
    if (!logger) return;
    logger.error(normalizeErrorContext(error), msg);
  },
};

/**
 * @internal - NOT part of public API
 * Maps a stored event document to a read event. Events written before `messageId` existed
 * get a stable id derived from stream name and version, so consumers can still deduplicate.
 */
function toReadEvent<EventType extends Event>(
  streamName: string,
  data: EventDocument,
): FirestoreReadEvent<EventType> {
  return {
    type: data.type,
    data: data.data,
    metadata: {
      ...data.metadata,
      messageId: data.messageId ?? `${streamName}:${data.streamVersion}`,
      streamName,
      streamVersion: BigInt(data.streamVersion),
      streamPosition: BigInt(data.streamVersion),
      globalPosition: BigInt(data.globalPosition),
      timestamp: timestampToDate(data.timestamp),
    },
  } as FirestoreReadEvent<EventType>;
}

const DEFAULT_COLLECTIONS: CollectionConfig = {
  streams: 'streams',
  counters: '_counters',
};

/**
 * Firestore Event Store Implementation
 *
 * Stores events in Firestore using a subcollection pattern:
 * - /streams/{streamName} - Stream metadata (version, timestamps)
 * - /streams/{streamName}/events/{version} - Individual events
 * - /_counters/global_position - Global event counter
 */
export class FirestoreEventStoreImpl implements FirestoreEventStore {
  public readonly collections: CollectionConfig;
  private readonly logger: Logger | undefined;
  private readonly hooks: FirestoreEventStoreHooks;

  constructor(
    public readonly firestore: Firestore,
    options: FirestoreEventStoreOptions = {},
  ) {
    this.hooks = options.hooks ?? {};
    this.collections = {
      ...DEFAULT_COLLECTIONS,
      ...options.collections,
    };
    this.logger = options.observability?.logger;

    safeLog.info(this.logger, 'FirestoreEventStore initialized');
  }

  /**
   * Read events from a stream
   */
  async readStream<EventType extends Event>(
    streamName: string,
    options?: ReadStreamOptions,
  ): Promise<FirestoreReadEvent<EventType>[]> {
    const span = tracer.startSpan('emmett.firestore.read_stream', {
      attributes: { 'emmett.stream_name': streamName },
    });

    try {
      const from = options && 'from' in options ? options.from : undefined;
      const to = options && 'to' in options ? options.to : undefined;
      const maxCountLimit =
        options && 'maxCount' in options && options.maxCount !== undefined
          ? Number(options.maxCount)
          : undefined;

      safeLog.debug(this.logger, 'Reading stream', {
        streamName,
        from: from?.toString(),
        to: to?.toString(),
        maxCount: maxCountLimit,
      });

      // Reference to events subcollection
      let query = this.firestore
        .collection(this.collections.streams)
        .doc(streamName)
        .collection('events')
        .orderBy('streamVersion', 'asc');

      // Apply range filters
      if (from !== undefined) {
        query = query.where('streamVersion', '>=', Number(from));
      }
      if (to !== undefined) {
        query = query.where('streamVersion', '<=', Number(to));
      }
      if (maxCountLimit !== undefined && maxCountLimit > 0) {
        query = query.limit(maxCountLimit);
      }

      // Execute query
      const snapshot = await query.get();

      // Transform Firestore documents to events
      const events = snapshot.docs.map((doc) =>
        toReadEvent<EventType>(streamName, doc.data() as EventDocument),
      );

      span.setAttribute('emmett.event_count', events.length);
      span.setStatus({ code: SpanStatusCode.OK });

      safeLog.debug(this.logger, 'Stream read completed', {
        streamName,
        eventCount: events.length,
      });

      return events;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });

      safeLog.error(this.logger, 'Failed to read stream', {
        streamName,
        error,
      });

      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Read events of every stream in global order.
   *
   * Uses a collection group query over `events`, so it needs a collection group index on
   * `globalPosition` (see the README for the index definition).
   */
  async readByGlobalPosition<EventType extends Event>(
    options: ReadByGlobalPositionOptions = {},
  ): Promise<FirestoreReadEvent<EventType>[]> {
    const span = tracer.startSpan('emmett.firestore.read_by_global_position');

    try {
      const { after, maxCount } = options;

      safeLog.debug(this.logger, 'Reading by global position', {
        after: after?.toString(),
        maxCount,
      });

      let query = this.firestore
        .collectionGroup('events')
        .orderBy('globalPosition', 'asc');

      if (after !== undefined) {
        query = query.where('globalPosition', '>', Number(after));
      }
      if (maxCount !== undefined && maxCount > 0) {
        query = query.limit(maxCount);
      }

      const snapshot = await query.get();

      // events/{version} lives under streams/{streamName}, so the stream name is the grandparent id
      const events = snapshot.docs.map((doc) =>
        toReadEvent<EventType>(
          doc.ref.parent.parent!.id,
          doc.data() as EventDocument,
        ),
      );

      span.setAttribute('emmett.event_count', events.length);
      span.setStatus({ code: SpanStatusCode.OK });

      return events;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });

      safeLog.error(this.logger, 'Failed to read by global position', {
        error,
      });

      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Aggregate stream by applying events to state
   */
  async aggregateStream<State, EventType extends Event>(
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
  }> {
    const { evolve, initialState, read } = options;
    const events = await this.readStream<EventType>(streamName, read);

    const streamExists = events.length > 0;
    const state = events.reduce(evolve, initialState());
    const currentStreamVersion = streamExists
      ? events[events.length - 1].metadata.streamVersion
      : BigInt(0);

    return {
      state,
      currentStreamVersion,
      streamExists,
    };
  }

  /**
   * Append events to a stream with optimistic concurrency control
   */
  async appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options: AppendToStreamOptions = {},
  ): Promise<AppendToStreamResult> {
    const span = tracer.startSpan('emmett.firestore.append_to_stream', {
      attributes: {
        'emmett.stream_name': streamName,
        'emmett.event_count': events.length,
      },
    });

    try {
      if (events.length === 0) {
        throw new Error('Cannot append empty event array');
      }

      const { expectedStreamVersion = NO_CONCURRENCY_CHECK, beforeCommit } =
        options;

      safeLog.debug(this.logger, 'Appending to stream', {
        streamName,
        eventCount: events.length,
        eventTypes: events.map((e) => e.type),
        expectedVersion: String(expectedStreamVersion),
      });

      // Execute in transaction for atomicity
      const result = await this.firestore.runTransaction(
        async (transaction) => {
          return await this.appendToStreamInTransaction(
            transaction,
            streamName,
            events,
            expectedStreamVersion,
            beforeCommit,
          );
        },
      );

      span.setAttribute(
        'emmett.new_version',
        Number(result.nextExpectedStreamVersion),
      );
      span.setAttribute('emmett.created_new_stream', result.createdNewStream);
      span.setStatus({ code: SpanStatusCode.OK });

      safeLog.debug(this.logger, 'Append completed', {
        streamName,
        newVersion: result.nextExpectedStreamVersion.toString(),
        createdNewStream: result.createdNewStream,
      });

      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });

      if (error instanceof ExpectedVersionConflictError) {
        safeLog.warn(this.logger, 'Version conflict during append', {
          streamName,
          expected: String(error.expected),
          actual: String(error.actual),
        });
      } else {
        safeLog.error(this.logger, 'Failed to append to stream', {
          streamName,
          error,
        });
      }

      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Internal method to append events within a transaction
   *
   * Note: No separate span here - this method runs inside appendToStream's span,
   * and Firestore transaction operations are atomic. The parent span captures
   * the full transaction duration.
   */
  private async appendToStreamInTransaction<EventType extends Event>(
    transaction: Transaction,
    streamName: string,
    events: EventType[],
    expectedStreamVersion: ExpectedStreamVersion,
    beforeCommit?: BeforeCommitHook,
  ): Promise<AppendToStreamResult> {
    // 1. Get stream metadata reference
    const streamRef = this.firestore
      .collection(this.collections.streams)
      .doc(streamName);

    const streamDoc = await transaction.get(streamRef);
    const streamExists = streamDoc.exists;
    const streamData = streamDoc.data() as StreamMetadata | undefined;

    // 2. Get current version and validate expected version
    const currentVersion = getCurrentStreamVersion(
      streamExists,
      streamData?.version,
    );

    safeLog.debug(this.logger, 'Read stream metadata', {
      streamName,
      exists: streamExists,
      currentVersion:
        currentVersion === STREAM_DOES_NOT_EXIST
          ? 'none'
          : currentVersion.toString(),
    });

    assertExpectedVersionMatchesCurrent(
      streamName,
      expectedStreamVersion,
      currentVersion,
    );

    // 3. Get and increment global position counter
    const counterRef = this.firestore
      .collection(this.collections.counters)
      .doc('global_position');

    const counterDoc = await transaction.get(counterRef);
    let globalPosition = counterDoc.exists
      ? ((counterDoc.data()?.value as number) ?? 0)
      : 0;

    // 4. Calculate starting version for new events
    const baseVersion =
      currentVersion === STREAM_DOES_NOT_EXIST ? -1 : Number(currentVersion);

    // 5. Append events to subcollection
    const TimestampClass = this.firestore.constructor as unknown as {
      Timestamp: typeof Timestamp;
    };
    const now = TimestampClass.Timestamp.now();
    const appendedEvents: AppendedEvent[] = [];

    events.forEach((event, index) => {
      const eventVersion = baseVersion + 1 + index;
      const eventRef = streamRef
        .collection('events')
        .doc(padVersion(eventVersion));

      const metadata = (event as { metadata?: Record<string, unknown> })
        .metadata;
      const messageId = randomUUID();
      const eventDocument: EventDocument = {
        type: event.type,
        data: event.data,
        ...(metadata && { metadata }),
        timestamp: now,
        globalPosition: globalPosition++,
        streamVersion: eventVersion,
        messageId,
      };

      transaction.set(eventRef, eventDocument);
      appendedEvents.push({
        type: eventDocument.type,
        data: eventDocument.data,
        ...(metadata && { metadata }),
        messageId,
        streamName,
        streamVersion: eventVersion,
        globalPosition: eventDocument.globalPosition,
        timestamp: now,
      });
    });

    // 6. Update stream metadata
    const newVersion = baseVersion + events.length;
    const updatedMetadata: StreamMetadata = {
      version: newVersion,
      createdAt: streamData?.createdAt ?? now,
      updatedAt: now,
    };

    transaction.set(streamRef, updatedMetadata);

    // 7. Update global position counter
    transaction.set(counterRef, {
      value: globalPosition,
      updatedAt: now,
    });

    safeLog.debug(this.logger, 'Events written to transaction', {
      streamName,
      count: events.length,
      newVersion,
    });

    // 8. Let the hooks add their own writes to this transaction: the store one, then the call one
    await this.hooks.beforeCommit?.(transaction, appendedEvents);
    await beforeCommit?.(transaction, appendedEvents);

    // 9. Return result
    return {
      nextExpectedStreamVersion: BigInt(newVersion),
      createdNewStream: !streamExists,
      messageIds: appendedEvents.map((event) => event.messageId),
    };
  }
}

/**
 * Creates an Emmett-compatible `EventStore` wrapper around a Firestore event store.
 */
function normalizeReadOptions(
  options?: EmmettReadStreamOptions<bigint>,
): ReadStreamOptions | undefined {
  if (!options) return undefined;

  const result: ReadStreamOptions = {};

  if ('from' in options) {
    result.from = options.from;
    if ('maxCount' in options && options.maxCount !== undefined) {
      result.maxCount = Number(options.maxCount);
    }
  }

  if ('to' in options) {
    result.to = options.to;
  }

  return result;
}

export function asEventStore(
  store: FirestoreEventStore,
): EventStore<FirestoreReadEventMetadata> {
  async function readStream<EventType extends Event>(
    streamName: string,
    options?: EmmettReadStreamOptions<bigint>,
  ): Promise<ReadStreamResult<EventType, FirestoreReadEventMetadata>> {
    const events = await store.readStream<EventType>(
      streamName,
      normalizeReadOptions(options),
    );
    const streamExists = events.length > 0;
    const currentStreamVersion = streamExists
      ? events[events.length - 1].metadata.streamVersion
      : BigInt(0);

    return {
      currentStreamVersion,
      events,
      streamExists,
    };
  }

  function aggregateStream<State, EventType extends Event>(
    streamName: string,
    options: AggregateStreamOptions<
      State,
      EventType,
      FirestoreReadEventMetadata
    >,
  ): Promise<AggregateStreamResult<State, bigint>> {
    return store.aggregateStream(streamName, {
      evolve: options.evolve,
      initialState: options.initialState,
      read: normalizeReadOptions(options.read),
    });
  }

  function appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions,
  ): Promise<AppendToStreamResult> {
    return store.appendToStream(streamName, events, options);
  }

  return {
    readStream,
    aggregateStream,
    appendToStream,
  };
}

/**
 * Factory function to create a Firestore event store
 *
 * @param firestore - Firestore instance
 * @param options - Optional configuration
 * @returns Firestore event store instance
 *
 * @example
 * ```typescript
 * import { Firestore } from '@google-cloud/firestore';
 * import { getFirestoreEventStore } from '@emmett-community/emmett-google-firestore';
 *
 * const firestore = new Firestore({ projectId: 'my-project' });
 * const eventStore = getFirestoreEventStore(firestore);
 * ```
 */
export function getFirestoreEventStore(
  firestore: Firestore,
  options?: FirestoreEventStoreOptions,
): FirestoreEventStore {
  return new FirestoreEventStoreImpl(firestore, options);
}
