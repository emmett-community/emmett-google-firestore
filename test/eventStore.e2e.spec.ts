import path from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import type { Event } from '@event-driven-io/emmett';
import { GenericContainer, Wait } from 'testcontainers';
import {
  getFirestoreEventStore,
  type FirestoreEventStore,
  ExpectedVersionConflictError,
} from '../src';

jest.setTimeout(60000);

type UserRegistered = Event<
  'UserRegistered',
  { userId: string; email: string; name: string }
>;

type UserEmailChanged = Event<
  'UserEmailChanged',
  { userId: string; newEmail: string }
>;

type UserEvent = UserRegistered | UserEmailChanged;

const projectId = 'demo-project';

let firestore: Firestore;
let eventStore: FirestoreEventStore;
let emulator: import('testcontainers').StartedTestContainer | null = null;
let emulatorHost = '';
let emulatorPort = 0;

const emulatorUrl = () => `http://${emulatorHost}:${emulatorPort}`;

const startEmulator = async () => {
  const container = await new GenericContainer('myfstartup/firebase-emulator-suite:15')
    .withPlatform('linux/amd64')
    .withExposedPorts(4000, 8080)
    .withBindMounts([
      {
        source: path.join(process.cwd(), 'test', 'support', 'firebase', 'firebase.json'),
        target: '/app/firebase.json',
        mode: 'ro' as const,
      },
      {
        source: path.join(process.cwd(), 'test', 'support', 'firebase', '.firebaserc'),
        target: '/app/.firebaserc',
        mode: 'ro' as const,
      },
    ])
    .withEnvironment({ PROJECT_ID: projectId })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();

  emulatorHost = container.getHost();
  emulatorPort = container.getMappedPort(8080);

  process.env.FIRESTORE_EMULATOR_HOST = `${emulatorHost}:${emulatorPort}`;
  process.env.FIRESTORE_PROJECT_ID = projectId;
  process.env.GCLOUD_PROJECT = projectId;

  return container;
};

const resetEmulator = async () => {
  const res = await fetch(
    `${emulatorUrl()}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );

  if (!res.ok) {
    throw new Error(`Failed to reset Firestore emulator: ${res.status} ${res.statusText}`);
  }
};

beforeAll(async () => {
  emulator = await startEmulator();

  firestore = new Firestore({
    projectId,
    host: `${emulatorHost}:${emulatorPort}`,
    ssl: false,
    customHeaders: {
      Authorization: 'Bearer owner',
    },
  });

  eventStore = getFirestoreEventStore(firestore);
});

afterAll(async () => {
  await firestore.terminate();
  if (emulator) {
    await emulator.stop();
  }
});

beforeEach(async () => {
  await resetEmulator();
});

describe('FirestoreEventStore E2E Tests', () => {
  describe('global position', () => {
    it('should assign sequential global positions across streams', async () => {
      await eventStore.appendToStream('User-A', [
        {
          type: 'UserRegistered',
          data: { userId: 'A', email: 'a@example.com', name: 'A' },
        } as UserEvent,
      ]);

      await eventStore.appendToStream('User-B', [
        {
          type: 'UserRegistered',
          data: { userId: 'B', email: 'b@example.com', name: 'B' },
        } as UserEvent,
      ]);

      const eventsA = await eventStore.readStream<UserEvent>('User-A');
      const eventsB = await eventStore.readStream<UserEvent>('User-B');

      expect(eventsA[0].metadata.globalPosition).toBe(BigInt(0));
      expect(eventsB[0].metadata.globalPosition).toBe(BigInt(1));
    });
  });

  describe('readStream', () => {
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

      await eventStore.appendToStream(streamName, [
        {
          type: 'UserRegistered',
          data: { userId: 'Conflict', email: 'test@example.com', name: 'Test' },
        } as UserEvent,
      ]);

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

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(4);

      failed.forEach((result) => {
        if (result.status === 'rejected') {
          expect(result.reason).toBeInstanceOf(ExpectedVersionConflictError);
        }
      });
    });
  });
});
