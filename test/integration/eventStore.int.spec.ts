import { Firestore } from '@google-cloud/firestore';
import type { Event } from '@event-driven-io/emmett';
import {
  getFirestoreEventStore,
  type FirestoreEventStore,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  NO_CONCURRENCY_CHECK,
  ExpectedVersionConflictError,
} from '../../src';

// Test events
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
  let firestore: Firestore;
  let eventStore: FirestoreEventStore;

  beforeAll(() => {
    // Connect to Firestore Emulator
    const projectId = process.env.FIRESTORE_PROJECT_ID || 'test-project';
    const host = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';

    firestore = new Firestore({
      projectId,
      host,
      ssl: false,
      customHeaders: {
        Authorization: 'Bearer owner',
      },
    });

    eventStore = getFirestoreEventStore(firestore);
  });

  afterAll(async () => {
    await firestore.terminate();
  });

  beforeEach(async () => {
    // Clear all collections before each test
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

      // First append
      await eventStore.appendToStream(streamName, [
        {
          type: 'UserRegistered',
          data: { userId: '789', email: 'test@example.com', name: 'Test' },
        } as UserEvent,
      ]);

      // Second append
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

        // Create stream
        await eventStore.appendToStream(streamName, [
          {
            type: 'UserRegistered',
            data: { userId: '333', email: 'test@example.com', name: 'Test' },
          } as UserEvent,
        ]);

        // Try to append with STREAM_DOES_NOT_EXIST
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

        // Create stream
        await eventStore.appendToStream(streamName, [
          {
            type: 'UserRegistered',
            data: { userId: '444', email: 'test@example.com', name: 'Test' },
          } as UserEvent,
        ]);

        // Append with STREAM_EXISTS
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

        // Create stream
        await eventStore.appendToStream(streamName, [
          {
            type: 'UserRegistered',
            data: { userId: '666', email: 'test@example.com', name: 'Test' },
          } as UserEvent,
        ]);

        // Append with correct version
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

        // Create stream
        await eventStore.appendToStream(streamName, [
          {
            type: 'UserRegistered',
            data: { userId: '777', email: 'test@example.com', name: 'Test' },
          } as UserEvent,
        ]);

        // Try to append with wrong version
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

    describe('global position', () => {
      it('should assign sequential global positions across streams', async () => {
        // Append to first stream
        await eventStore.appendToStream('User-A', [
          {
            type: 'UserRegistered',
            data: { userId: 'A', email: 'a@example.com', name: 'A' },
          } as UserEvent,
        ]);

        // Append to second stream
        await eventStore.appendToStream('User-B', [
          {
            type: 'UserRegistered',
            data: { userId: 'B', email: 'b@example.com', name: 'B' },
          } as UserEvent,
        ]);

        // Read both streams
        const eventsA = await eventStore.readStream<UserEvent>('User-A');
        const eventsB = await eventStore.readStream<UserEvent>('User-B');

        expect(eventsA[0].metadata.globalPosition).toBe(BigInt(0));
        expect(eventsB[0].metadata.globalPosition).toBe(BigInt(1));
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

    it('should read events with from option', async () => {
      const streamName = 'User-GHI';
      const events: UserEvent[] = [
        {
          type: 'UserRegistered',
          data: { userId: 'GHI', email: '1@example.com', name: '1' },
        },
        {
          type: 'UserEmailChanged',
          data: { userId: 'GHI', newEmail: '2@example.com' },
        },
        {
          type: 'UserEmailChanged',
          data: { userId: 'GHI', newEmail: '3@example.com' },
        },
      ];

      await eventStore.appendToStream(streamName, events);

      const readEvents = await eventStore.readStream<UserEvent>(streamName, {
        from: BigInt(1),
      });

      expect(readEvents).toHaveLength(2);
      expect(readEvents[0].metadata.streamVersion).toBe(BigInt(1));
      expect(readEvents[1].metadata.streamVersion).toBe(BigInt(2));
    });

    it('should read events with to option', async () => {
      const streamName = 'User-JKL';
      const events: UserEvent[] = [
        {
          type: 'UserRegistered',
          data: { userId: 'JKL', email: '1@example.com', name: '1' },
        },
        {
          type: 'UserEmailChanged',
          data: { userId: 'JKL', newEmail: '2@example.com' },
        },
        {
          type: 'UserEmailChanged',
          data: { userId: 'JKL', newEmail: '3@example.com' },
        },
      ];

      await eventStore.appendToStream(streamName, events);

      const readEvents = await eventStore.readStream<UserEvent>(streamName, {
        to: BigInt(1),
      });

      expect(readEvents).toHaveLength(2);
      expect(readEvents[0].metadata.streamVersion).toBe(BigInt(0));
      expect(readEvents[1].metadata.streamVersion).toBe(BigInt(1));
    });

    it('should read events with from and to range', async () => {
      const streamName = 'User-MNO';
      const events: UserEvent[] = [
        {
          type: 'UserRegistered',
          data: { userId: 'MNO', email: '0@example.com', name: '0' },
        },
        {
          type: 'UserEmailChanged',
          data: { userId: 'MNO', newEmail: '1@example.com' },
        },
        {
          type: 'UserEmailChanged',
          data: { userId: 'MNO', newEmail: '2@example.com' },
        },
        {
          type: 'UserEmailChanged',
          data: { userId: 'MNO', newEmail: '3@example.com' },
        },
      ];

      await eventStore.appendToStream(streamName, events);

      const readEvents = await eventStore.readStream<UserEvent>(streamName, {
        from: BigInt(1),
        to: BigInt(2),
      });

      expect(readEvents).toHaveLength(2);
      expect(readEvents[0].metadata.streamVersion).toBe(BigInt(1));
      expect(readEvents[1].metadata.streamVersion).toBe(BigInt(2));
    });

    it('should limit events with maxCount option', async () => {
      const streamName = 'User-PQR';
      const events: UserEvent[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'UserEmailChanged',
        data: { userId: 'PQR', newEmail: `${i}@example.com` },
      })) as UserEvent[];

      await eventStore.appendToStream(streamName, events);

      const readEvents = await eventStore.readStream<UserEvent>(streamName, {
        maxCount: 5,
      });

      expect(readEvents).toHaveLength(5);
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

    it('should aggregate with range options', async () => {
      const streamName = 'User-YZ';
      await eventStore.appendToStream(streamName, [
        {
          type: 'UserRegistered',
          data: { userId: 'YZ', email: '1@example.com', name: 'YZ' },
        } as UserEvent,
        {
          type: 'UserEmailChanged',
          data: { userId: 'YZ', newEmail: '2@example.com' },
        } as UserEvent,
        {
          type: 'UserEmailChanged',
          data: { userId: 'YZ', newEmail: '3@example.com' },
        } as UserEvent,
      ]);

      // Aggregate only first two events
      const result = await eventStore.aggregateStream(streamName, {
        evolve,
        initialState,
        read: { to: BigInt(1) },
      });

      expect(result.state.email).toBe('2@example.com');
      expect(result.streamExists).toBe(true);
      expect(result.currentStreamVersion).toBe(BigInt(1));
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent appends to different streams', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        eventStore.appendToStream(`User-Concurrent-${i}`, [
          {
            type: 'UserRegistered',
            data: { userId: `${i}`, email: `${i}@example.com`, name: `User${i}` },
          } as UserEvent,
        ]),
      );

      const results = await Promise.all(promises);

      results.forEach((result) => {
        expect(result.nextExpectedStreamVersion).toBe(BigInt(0));
        expect(result.createdNewStream).toBe(true);
      });
    });

    it('should detect version conflicts in concurrent appends to same stream', async () => {
      const streamName = 'User-Conflict';

      // Create stream
      await eventStore.appendToStream(streamName, [
        {
          type: 'UserRegistered',
          data: { userId: 'Conflict', email: 'test@example.com', name: 'Test' },
        } as UserEvent,
      ]);

      // Try concurrent appends with same expected version
      const promises = Array.from({ length: 5 }, () =>
        eventStore.appendToStream(
          streamName,
          [
            {
              type: 'UserEmailChanged',
              data: { userId: 'Conflict', newEmail: 'new@example.com' },
            } as UserEvent,
          ],
          { expectedStreamVersion: BigInt(0) },
        ),
      );

      const results = await Promise.allSettled(promises);

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      // Only one should succeed
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(4);

      // Failed ones should have ExpectedVersionConflictError
      failed.forEach((result) => {
        if (result.status === 'rejected') {
          expect(result.reason).toBeInstanceOf(ExpectedVersionConflictError);
        }
      });
    });
  });
});

// Helper function to delete a collection
async function deleteCollection(
  firestore: Firestore,
  collectionPath: string,
  batchSize = 100,
): Promise<void> {
  const collectionRef = firestore.collection(collectionPath);
  const query = collectionRef.limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(firestore, query, resolve, reject);
  });
}

async function deleteQueryBatch(
  firestore: Firestore,
  query: FirebaseFirestore.Query,
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
      batch.delete(doc.ref);
    });
    await batch.commit();

    process.nextTick(() => {
      void deleteQueryBatch(firestore, query, resolve, reject);
    });
  } catch (error) {
    reject(error as Error);
  }
}
