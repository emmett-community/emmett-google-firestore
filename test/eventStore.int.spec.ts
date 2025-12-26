import type { Firestore } from '@google-cloud/firestore';
import type { Event } from '@event-driven-io/emmett';
import {
  getFirestoreEventStore,
  type FirestoreEventStore,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  NO_CONCURRENCY_CHECK,
  ExpectedVersionConflictError,
} from '../src';
import { InMemoryFirestore } from './support/inMemoryFirestore';

type UserRegistered = Event<
  'UserRegistered',
  { userId: string; email: string; name: string }
>;

type UserEmailChanged = Event<
  'UserEmailChanged',
  { userId: string; newEmail: string }
>;

type UserEvent = UserRegistered | UserEmailChanged;

describe('FirestoreEventStore Integration Tests', () => {
  let firestore: InMemoryFirestore;
  let eventStore: FirestoreEventStore;

  beforeAll(() => {
    firestore = new InMemoryFirestore();
    eventStore = getFirestoreEventStore(firestore as unknown as Firestore);
  });

  afterAll(async () => {
    await firestore.terminate();
  });

  beforeEach(async () => {
    const collections = await firestore.listCollections();
    for (const collection of collections) {
      await deleteCollection(firestore, collection.id);
    }
  });

  describe('appendToStream', () => {
    it('should append events to a new stream', async () => {
      const streamName = 'User-123';
      const events: UserEvent[] = [
        {
          type: 'UserRegistered',
          data: {
            userId: '123',
            email: 'user@example.com',
            name: 'John Doe',
          },
        },
      ];

      const result = await eventStore.appendToStream(streamName, events);

      expect(result.nextExpectedStreamVersion).toBe(BigInt(0));
      expect(result.createdNewStream).toBe(true);
    });

    it('should append multiple events at once', async () => {
      const streamName = 'User-456';
      const events: UserEvent[] = [
        {
          type: 'UserRegistered',
          data: { userId: '456', email: 'user@example.com', name: 'Jane' },
        },
        {
          type: 'UserEmailChanged',
          data: { userId: '456', newEmail: 'jane@example.com' },
        },
      ];

      const result = await eventStore.appendToStream(streamName, events);

      expect(result.nextExpectedStreamVersion).toBe(BigInt(1));
      expect(result.createdNewStream).toBe(true);
    });

    it('should append events to existing stream', async () => {
      const streamName = 'User-789';

      await eventStore.appendToStream(streamName, [
        {
          type: 'UserRegistered',
          data: { userId: '789', email: 'test@example.com', name: 'Test' },
        } as UserEvent,
      ]);

      const result = await eventStore.appendToStream(streamName, [
        {
          type: 'UserEmailChanged',
          data: { userId: '789', newEmail: 'new@example.com' },
        } as UserEvent,
      ]);

      expect(result.nextExpectedStreamVersion).toBe(BigInt(1));
      expect(result.createdNewStream).toBe(false);
    });

    it('should throw error when appending empty array', async () => {
      await expect(
        eventStore.appendToStream('User-999', []),
      ).rejects.toThrow('Cannot append empty event array');
    });

    describe('optimistic concurrency', () => {
      it('should succeed with NO_CONCURRENCY_CHECK expected version', async () => {
        const streamName = 'User-111';

        const result = await eventStore.appendToStream(
          streamName,
          [
            {
              type: 'UserRegistered',
              data: { userId: '111', email: 'test@example.com', name: 'Test' },
            } as UserEvent,
          ],
          { expectedStreamVersion: NO_CONCURRENCY_CHECK },
        );

        expect(result.nextExpectedStreamVersion).toBe(BigInt(0));
      });

      it('should succeed when stream does not exist with STREAM_DOES_NOT_EXIST', async () => {
        const streamName = 'User-222';

        const result = await eventStore.appendToStream(
          streamName,
          [
            {
              type: 'UserRegistered',
              data: { userId: '222', email: 'test@example.com', name: 'Test' },
            } as UserEvent,
          ],
          { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
        );

        expect(result.nextExpectedStreamVersion).toBe(BigInt(0));
      });

      it('should fail when stream exists with STREAM_DOES_NOT_EXIST expectation', async () => {
        const streamName = 'User-333';

        await eventStore.appendToStream(streamName, [
          {
            type: 'UserRegistered',
            data: { userId: '333', email: 'test@example.com', name: 'Test' },
          } as UserEvent,
        ]);

        await expect(
          eventStore.appendToStream(
            streamName,
            [
              {
                type: 'UserEmailChanged',
                data: { userId: '333', newEmail: 'new@example.com' },
              } as UserEvent,
            ],
            { expectedStreamVersion: STREAM_DOES_NOT_EXIST },
          ),
        ).rejects.toThrow(ExpectedVersionConflictError);
      });

      it('should succeed when stream exists with STREAM_EXISTS', async () => {
        const streamName = 'User-444';

        await eventStore.appendToStream(streamName, [
          {
            type: 'UserRegistered',
            data: { userId: '444', email: 'test@example.com', name: 'Test' },
          } as UserEvent,
        ]);

        const result = await eventStore.appendToStream(
          streamName,
          [
            {
              type: 'UserEmailChanged',
              data: { userId: '444', newEmail: 'new@example.com' },
            } as UserEvent,
          ],
          { expectedStreamVersion: STREAM_EXISTS },
        );

        expect(result.nextExpectedStreamVersion).toBe(BigInt(1));
      });

      it('should fail when stream does not exist with STREAM_EXISTS', async () => {
        const streamName = 'User-555';

        await expect(
          eventStore.appendToStream(
            streamName,
            [
              {
                type: 'UserRegistered',
                data: { userId: '555', email: 'test@example.com', name: 'Test' },
              } as UserEvent,
            ],
            { expectedStreamVersion: STREAM_EXISTS },
          ),
        ).rejects.toThrow(ExpectedVersionConflictError);
      });

      it('should succeed with correct specific version', async () => {
        const streamName = 'User-666';

        await eventStore.appendToStream(streamName, [
          {
            type: 'UserRegistered',
            data: { userId: '666', email: 'test@example.com', name: 'Test' },
          } as UserEvent,
        ]);

        const result = await eventStore.appendToStream(
          streamName,
          [
            {
              type: 'UserEmailChanged',
              data: { userId: '666', newEmail: 'new@example.com' },
            } as UserEvent,
          ],
          { expectedStreamVersion: BigInt(0) },
        );

        expect(result.nextExpectedStreamVersion).toBe(BigInt(1));
      });

      it('should fail with incorrect specific version', async () => {
        const streamName = 'User-777';

        await eventStore.appendToStream(streamName, [
          {
            type: 'UserRegistered',
            data: { userId: '777', email: 'test@example.com', name: 'Test' },
          } as UserEvent,
        ]);

        await expect(
          eventStore.appendToStream(
            streamName,
            [
              {
                type: 'UserEmailChanged',
                data: { userId: '777', newEmail: 'new@example.com' },
              } as UserEvent,
            ],
            { expectedStreamVersion: BigInt(5) },
          ),
        ).rejects.toThrow(ExpectedVersionConflictError);
      });
    });
  });

  describe('readStream', () => {
    it('should return empty array for non-existent stream', async () => {
      const events = await eventStore.readStream('NonExistent-999');
      expect(events).toEqual([]);
    });

    it('should read all events from a stream', async () => {
      const streamName = 'User-ABC';
      const appendedEvents: UserEvent[] = [
        {
          type: 'UserRegistered',
          data: { userId: 'ABC', email: 'abc@example.com', name: 'ABC' },
        },
        {
          type: 'UserEmailChanged',
          data: { userId: 'ABC', newEmail: 'new-abc@example.com' },
        },
      ];

      await eventStore.appendToStream(streamName, appendedEvents);

      const events = await eventStore.readStream<UserEvent>(streamName);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('UserRegistered');
      if (events[0].type === 'UserRegistered') {
        expect(events[0].data.email).toBe('abc@example.com');
      }
      expect(events[1].type).toBe('UserEmailChanged');
      if (events[1].type === 'UserEmailChanged') {
        expect(events[1].data.newEmail).toBe('new-abc@example.com');
      }
    });

    it('should include correct metadata', async () => {
      const streamName = 'User-DEF';

      await eventStore.appendToStream(streamName, [
        {
          type: 'UserRegistered',
          data: { userId: 'DEF', email: 'def@example.com', name: 'DEF' },
        } as UserEvent,
      ]);

      const events = await eventStore.readStream<UserEvent>(streamName);

      expect(events[0].metadata.streamName).toBe(streamName);
      expect(events[0].metadata.streamVersion).toBe(BigInt(0));
      expect(events[0].metadata.streamPosition).toBe(BigInt(0));
      expect(events[0].metadata.globalPosition).toBeGreaterThanOrEqual(BigInt(0));
      expect(events[0].metadata.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('aggregateStream', () => {
    type UserState = {
      status: 'Empty' | 'Registered' | 'Deleted';
      userId?: string;
      email?: string;
      name?: string;
    };

    const evolve = (state: UserState, event: UserEvent): UserState => {
      switch (event.type) {
        case 'UserRegistered':
          return {
            status: 'Registered',
            userId: event.data.userId,
            email: event.data.email,
            name: event.data.name,
          };
        case 'UserEmailChanged':
          return {
            ...state,
            email: event.data.newEmail,
          };
        default:
          return state;
      }
    };

    const initialState = (): UserState => ({ status: 'Empty' });

    it('should aggregate empty stream to initial state', async () => {
      const result = await eventStore.aggregateStream('User-STU', {
        evolve,
        initialState,
      });

      expect(result.state.status).toBe('Empty');
      expect(result.streamExists).toBe(false);
      expect(result.currentStreamVersion).toBe(BigInt(0));
    });

    it('should aggregate events to current state', async () => {
      const streamName = 'User-VWX';
      await eventStore.appendToStream(streamName, [
        {
          type: 'UserRegistered',
          data: { userId: 'VWX', email: 'vwx@example.com', name: 'VWX' },
        } as UserEvent,
        {
          type: 'UserEmailChanged',
          data: { userId: 'VWX', newEmail: 'new-vwx@example.com' },
        } as UserEvent,
      ]);

      const result = await eventStore.aggregateStream(streamName, {
        evolve,
        initialState,
      });

      expect(result.state.status).toBe('Registered');
      expect(result.state.userId).toBe('VWX');
      expect(result.state.email).toBe('new-vwx@example.com');
      expect(result.state.name).toBe('VWX');
      expect(result.streamExists).toBe(true);
      expect(result.currentStreamVersion).toBe(BigInt(1));
    });
  });
});

async function deleteCollection(
  firestore: InMemoryFirestore,
  collectionPath: string,
  batchSize = 100,
): Promise<void> {
  const collectionRef = firestore.collection(collectionPath);
  const query = collectionRef.limit(batchSize);

  return new Promise((resolve, reject) => {
    void deleteQueryBatch(firestore, query, resolve, reject);
  });
}

async function deleteQueryBatch(
  firestore: InMemoryFirestore,
  query: { get: () => Promise<{ size: number; docs: Array<{ ref: unknown }> }> },
  resolve: () => void,
  reject: (error: Error) => void,
): Promise<void> {
  try {
    const snapshot = await query.get();

    if (snapshot.size === 0) {
      resolve();
      return;
    }

    const batch = firestore.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref as any);
    });
    await batch.commit();

    process.nextTick(() => {
      void deleteQueryBatch(firestore, query, resolve, reject);
    });
  } catch (error) {
    reject(error as Error);
  }
}
