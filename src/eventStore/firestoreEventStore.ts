import type { Firestore, Transaction, Timestamp } from '@google-cloud/firestore';
import type { Event } from '@event-driven-io/emmett';
import type {
  AppendToStreamOptions,
  AppendToStreamResult,
  CollectionConfig,
  EventDocument,
  ExpectedStreamVersion,
  FirestoreEventStore,
  FirestoreEventStoreOptions,
  FirestoreReadEvent,
  ReadStreamOptions,
  StreamMetadata,
} from './types';
import { NO_CONCURRENCY_CHECK, STREAM_DOES_NOT_EXIST } from './types';
import {
  assertExpectedVersionMatchesCurrent,
  getCurrentStreamVersion,
  padVersion,
  timestampToDate,
} from './utils';

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

  constructor(
    public readonly firestore: Firestore,
    options: FirestoreEventStoreOptions = {},
  ) {
    this.collections = {
      ...DEFAULT_COLLECTIONS,
      ...options.collections,
    };
  }

  /**
   * Read events from a stream
   */
  async readStream<EventType extends Event>(
    streamName: string,
    options: ReadStreamOptions = {},
  ): Promise<FirestoreReadEvent<EventType>[]> {
    const { from, to, maxCount } = options;

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
    if (maxCount !== undefined && maxCount > 0) {
      query = query.limit(maxCount);
    }

    // Execute query
    const snapshot = await query.get();

    // Transform Firestore documents to events
    return snapshot.docs.map((doc) => {
      const data = doc.data() as EventDocument;
      return {
        type: data.type,
        data: data.data,
        metadata: {
          ...data.metadata,
          streamName,
          streamVersion: BigInt(data.streamVersion),
          streamPosition: BigInt(data.streamVersion),
          globalPosition: BigInt(data.globalPosition),
          timestamp: timestampToDate(data.timestamp),
        },
      } as FirestoreReadEvent<EventType>;
    });
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
    if (events.length === 0) {
      throw new Error('Cannot append empty event array');
    }

    const { expectedStreamVersion = NO_CONCURRENCY_CHECK } = options;

    // Execute in transaction for atomicity
    return await this.firestore.runTransaction(async (transaction) => {
      return await this.appendToStreamInTransaction(
        transaction,
        streamName,
        events,
        expectedStreamVersion,
      );
    });
  }

  /**
   * Internal method to append events within a transaction
   */
  private async appendToStreamInTransaction<EventType extends Event>(
    transaction: Transaction,
    streamName: string,
    events: EventType[],
    expectedStreamVersion: ExpectedStreamVersion,
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
      ? (counterDoc.data()?.value as number) ?? 0
      : 0;

    // 4. Calculate starting version for new events
    const baseVersion =
      currentVersion === STREAM_DOES_NOT_EXIST ? -1 : Number(currentVersion);

    // 5. Append events to subcollection
    const TimestampClass = this.firestore.constructor as unknown as { Timestamp: typeof Timestamp };
    const now = TimestampClass.Timestamp.now();

    events.forEach((event, index) => {
      const eventVersion = baseVersion + 1 + index;
      const eventRef = streamRef
        .collection('events')
        .doc(padVersion(eventVersion));

      const metadata = (event as { metadata?: Record<string, unknown> }).metadata;
      const eventDocument: EventDocument = {
        type: event.type,
        data: event.data,
        ...(metadata && { metadata }),
        timestamp: now,
        globalPosition: globalPosition++,
        streamVersion: eventVersion,
      };

      transaction.set(eventRef, eventDocument);
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

    // 8. Return result
    return {
      nextExpectedStreamVersion: BigInt(newVersion),
      createdNewStream: !streamExists,
    };
  }
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
