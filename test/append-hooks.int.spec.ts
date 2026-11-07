import type { Event } from '@event-driven-io/emmett';
import type { Firestore } from '@google-cloud/firestore';
import {
  asEventStore,
  ExpectedVersionConflictError,
  getFirestoreEventStore,
  STREAM_DOES_NOT_EXIST,
  type AppendedEvent,
  type FirestoreEventStoreHooks,
} from '../src';
import { InMemoryFirestore } from '../src/testing';

type Registered = Event<'Registered', { name: string }>;

const registered = (name: string): Registered => ({ type: 'Registered', data: { name } });

describe('append hooks and returned message ids', () => {
  let firestore: InMemoryFirestore;

  beforeEach(() => {
    firestore = new InMemoryFirestore();
  });

  const newStore = (hooks?: FirestoreEventStoreHooks) =>
    getFirestoreEventStore(firestore as unknown as Firestore, { hooks });

  const extraDocs = async () => (await firestore.collection('extra').get()).size;

  const writeExtraDocs: FirestoreEventStoreHooks['beforeCommit'] = (transaction, events) => {
    for (const event of events) {
      const ref = firestore.collection('extra').doc(event.messageId);
      transaction.set(ref as never, { type: event.type });
    }
  };

  it('returns the stored messageId of each event, in order', async () => {
    const store = newStore();

    const { messageIds } = await store.appendToStream('User-1', [registered('a'), registered('b')]);

    const stored = await store.readStream<Registered>('User-1');
    expect(messageIds).toEqual(stored.map((event) => event.metadata.messageId));
  });

  it('returns the messageIds through the Emmett wrapper', async () => {
    const store = newStore();

    const result = await asEventStore(store).appendToStream('User-1', [registered('a')]);

    const [stored] = await store.readStream<Registered>('User-1');
    expect((result as unknown as { messageIds: string[] }).messageIds).toEqual([
      stored.metadata.messageId,
    ]);
  });

  it('hands the hook each event with its identity and position', async () => {
    let received: AppendedEvent[] = [];
    const store = newStore({
      beforeCommit: (_transaction, events) => {
        received = events;
      },
    });
    await store.appendToStream('User-0', [registered('first')]);

    await store.appendToStream('User-1', [
      { ...registered('a'), metadata: { actor: 'someone' } } as Registered,
      registered('b'),
    ]);

    const stored = await store.readStream<Registered>('User-1');
    expect(received.map((event) => event.messageId)).toEqual(
      stored.map((event) => event.metadata.messageId),
    );
    expect(received[0]).toMatchObject({
      type: 'Registered',
      data: { name: 'a' },
      metadata: { actor: 'someone' },
      streamName: 'User-1',
      streamVersion: 0,
      globalPosition: 1,
    });
    expect(received[1]).toMatchObject({ streamVersion: 1, globalPosition: 2 });
    expect(received[1]).not.toHaveProperty('metadata');
  });

  it('commits the writes of the hook together with the events', async () => {
    const store = newStore({ beforeCommit: writeExtraDocs });

    await store.appendToStream('User-1', [registered('a'), registered('b')]);

    expect(await extraDocs()).toBe(2);
    expect(await store.readStream('User-1')).toHaveLength(2);
  });

  it('stores nothing when the hook throws', async () => {
    const failure = new Error('hook failed');
    const store = newStore({
      beforeCommit: (transaction, events) => {
        writeExtraDocs(transaction, events);
        throw failure;
      },
    });

    await expect(store.appendToStream('User-1', [registered('a')])).rejects.toBe(failure);

    expect(await store.readStream('User-1')).toEqual([]);
    expect(await extraDocs()).toBe(0);
  });

  it('does not run the hook when the append conflicts', async () => {
    const beforeCommit = jest.fn();
    const store = newStore({ beforeCommit });
    await newStore().appendToStream('User-1', [registered('a')]);

    const append = store.appendToStream('User-1', [registered('b')], {
      expectedStreamVersion: STREAM_DOES_NOT_EXIST,
    });

    await expect(append).rejects.toBeInstanceOf(ExpectedVersionConflictError);
    expect(beforeCommit).not.toHaveBeenCalled();
  });

  it('works with an asynchronous hook', async () => {
    const store = newStore({
      beforeCommit: async (transaction, events) => {
        await Promise.resolve();
        writeExtraDocs(transaction, events);
      },
    });

    await store.appendToStream('User-1', [registered('a')]);

    expect(await extraDocs()).toBe(1);
  });
});
