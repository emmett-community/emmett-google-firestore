import type { Firestore } from '@google-cloud/firestore';
import {
  CommandHandler,
  isExpectedVersionConflictError,
  type Event,
} from '@event-driven-io/emmett';
import {
  asEventStore,
  ExpectedVersionConflictError,
  getFirestoreEventStore,
} from '../src';
import { InMemoryFirestore } from './support/inMemoryFirestore';

type Counted = Event<'Counted', { by: string }>;

// Emmett's command handler recognizes the version conflict of this store by its error code, so
// with `retry: { onVersionConflict: true }` it decides the command again on the new state
describe("Version conflict and Emmett's command handler", () => {
  let firestore: InMemoryFirestore;

  beforeEach(() => {
    firestore = new InMemoryFirestore();
  });

  afterEach(async () => {
    await firestore.terminate();
  });

  it('is an expected version conflict for Emmett', () => {
    expect(
      isExpectedVersionConflictError(
        new ExpectedVersionConflictError('Counter-1', 1n, 2n),
      ),
    ).toBe(true);
  });

  it('is retried by the command handler when another append won the race', async () => {
    const store = getFirestoreEventStore(firestore as unknown as Firestore);
    const eventStore = asEventStore(store);
    const handle = CommandHandler<number, Counted>({
      evolve: (count) => count + 1,
      initialState: () => 0,
      retry: { onVersionConflict: true },
    });
    let attempts = 0;

    await handle(eventStore, 'Counter-1', async (count) => {
      attempts += 1;
      if (attempts === 1) {
        await store.appendToStream('Counter-1', [
          { type: 'Counted', data: { by: 'other writer' } },
        ]);
      }
      return { type: 'Counted', data: { by: `handler after ${count}` } };
    });

    const events = await store.readStream<Counted>('Counter-1');
    expect(attempts).toBe(2);
    expect(events.map((event) => event.data.by)).toEqual([
      'other writer',
      'handler after 1',
    ]);
  });
});
