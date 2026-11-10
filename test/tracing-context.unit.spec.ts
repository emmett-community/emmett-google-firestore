import type { Firestore } from '@google-cloud/firestore';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { getFirestoreEventStore } from '../src';
import { InMemoryFirestore } from './support/inMemoryFirestore';

const exporter = new InMemorySpanExporter();
const contextManager = new AsyncLocalStorageContextManager();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

const activeSpanId = () => trace.getActiveSpan()?.spanContext().spanId;
const finished = (name: string): ReadableSpan[] =>
  exporter.getFinishedSpans().filter((span) => span.name === name);

// The Firestore client creates its spans under the active span, so the calls of the event store
// to the client must run with the operation span active
describe('Tracing context', () => {
  let firestore: InMemoryFirestore;

  beforeAll(() => {
    provider.register({ contextManager: contextManager.enable() });
  });

  beforeEach(() => {
    firestore = new InMemoryFirestore();
  });

  afterEach(async () => {
    exporter.reset();
    jest.restoreAllMocks();
    await firestore.terminate();
  });

  afterAll(async () => {
    await provider.shutdown();
    contextManager.disable();
    trace.disable();
    context.disable();
  });

  it('runs the transaction of an append and its hooks with the append span active', async () => {
    const runTransaction = firestore.runTransaction.bind(firestore);
    let seenByClient: string | undefined;
    jest.spyOn(firestore, 'runTransaction').mockImplementation((update) => {
      seenByClient = activeSpanId();
      return runTransaction(update);
    });
    let seenByHook: string | undefined;
    const eventStore = getFirestoreEventStore(
      firestore as unknown as Firestore,
    );

    await eventStore.appendToStream(
      'Test-1',
      [{ type: 'TestEvent', data: { value: 1 } }],
      {
        beforeCommit: () => {
          seenByHook = activeSpanId();
        },
      },
    );

    const [append] = finished('emmett.firestore.append_to_stream');
    expect(seenByClient).toBe(append.spanContext().spanId);
    expect(seenByHook).toBe(append.spanContext().spanId);
  });

  it('runs the queries of the reads with the read span active', async () => {
    const eventStore = getFirestoreEventStore(
      firestore as unknown as Firestore,
    );
    await eventStore.appendToStream('Test-1', [
      { type: 'TestEvent', data: { value: 1 } },
    ]);
    const queryPrototype = Object.getPrototypeOf(
      firestore.collection('any').orderBy('any'),
    ) as { get: () => Promise<unknown> };
    const get = queryPrototype.get;
    const seen: (string | undefined)[] = [];
    jest.spyOn(queryPrototype, 'get').mockImplementation(function (
      this: unknown,
    ) {
      seen.push(activeSpanId());
      return get.call(this);
    });

    await eventStore.readStream('Test-1');
    await eventStore.readByGlobalPosition();

    const [read] = finished('emmett.firestore.read_stream');
    const [readAll] = finished('emmett.firestore.read_by_global_position');
    expect(seen).toEqual([
      read.spanContext().spanId,
      readAll.spanContext().spanId,
    ]);
  });
});
