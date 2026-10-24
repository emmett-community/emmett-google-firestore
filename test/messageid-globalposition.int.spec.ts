import type { Event } from '@event-driven-io/emmett';
import type { Firestore } from '@google-cloud/firestore';
import { ExpectedVersionConflictError, getFirestoreEventStore, STREAM_DOES_NOT_EXIST } from '../src';
import { InMemoryFirestore } from '../src/testing';

type Registered = Event<'Registered', { name: string }>;

const registered = (name: string): Registered => ({ type: 'Registered', data: { name } });

describe('messageId, global position and conflict status', () => {
  let firestore: InMemoryFirestore;

  beforeEach(() => {
    firestore = new InMemoryFirestore();
  });

  const newStore = () => getFirestoreEventStore(firestore as unknown as Firestore);

  it('stores a unique messageId on every event and returns it when reading', async () => {
    const store = newStore();
    await store.appendToStream('User-1', [registered('a'), registered('b')]);

    const events = await store.readStream<Registered>('User-1');

    const ids = events.map((e) => e.metadata.messageId);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it('derives a stable messageId for events stored without one', async () => {
    const store = newStore();
    await store.appendToStream('User-1', [registered('a')]);
    const doc = firestore.collection('streams').doc('User-1').collection('events').doc('0000000000');
    const stored = (await firestore.runTransaction((t) => t.get(doc))).data()!;
    const { messageId: _omitted, ...legacy } = stored;
    await firestore.runTransaction(async (t) => t.set(doc, legacy));

    const [event] = await store.readStream<Registered>('User-1');

    expect(event.metadata.messageId).toBe('User-1:0');
  });

  it('reads events of every stream in global order, after a position', async () => {
    const store = newStore();
    await store.appendToStream('User-1', [registered('a')]);
    await store.appendToStream('User-2', [registered('b')]);
    await store.appendToStream('User-1', [registered('c')]);

    const all = await store.readByGlobalPosition<Registered>();
    expect(all.map((e) => e.data.name)).toEqual(['a', 'b', 'c']);
    expect(all.map((e) => e.metadata.streamName)).toEqual(['User-1', 'User-2', 'User-1']);
    expect(all.map((e) => e.metadata.globalPosition)).toEqual([0n, 1n, 2n]);

    const rest = await store.readByGlobalPosition<Registered>({ after: 0n, maxCount: 1 });
    expect(rest.map((e) => e.data.name)).toEqual(['b']);
  });

  it('throws a conflict error with status 412', async () => {
    const store = newStore();
    await store.appendToStream('User-1', [registered('a')]);

    const error = await store
      .appendToStream('User-1', [registered('b')], { expectedStreamVersion: STREAM_DOES_NOT_EXIST })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExpectedVersionConflictError);
    expect((error as ExpectedVersionConflictError).statusCode).toBe(412);
    expect((error as ExpectedVersionConflictError).errorCode).toBe(412);
  });
});
