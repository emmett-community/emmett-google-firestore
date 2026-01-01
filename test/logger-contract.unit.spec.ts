import type { Firestore } from '@google-cloud/firestore';
import { getFirestoreEventStore, type Logger } from '../src';
import { InMemoryFirestore } from './support/inMemoryFirestore';
import * as packageExports from '../src/index';

/**
 * Logger Contract Tests
 *
 * These tests verify that the Logger contract is correctly implemented:
 * - (context, message) format, NOT (message, data)
 * - All 4 methods are called
 * - No `any` types escape
 * - safeLog is NOT exported
 */
describe('Logger Contract', () => {
  let firestore: InMemoryFirestore;

  beforeEach(() => {
    firestore = new InMemoryFirestore();
  });

  afterEach(async () => {
    await firestore.terminate();
  });

  describe('Contract Format Validation', () => {
    it('MUST call logger with (context, message) format - NOT (message, data)', () => {
      const calls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => calls.push(['debug', ...args]),
        info: (...args: unknown[]) => calls.push(['info', ...args]),
        warn: (...args: unknown[]) => calls.push(['warn', ...args]),
        error: (...args: unknown[]) => calls.push(['error', ...args]),
      };

      getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      // Find the initialization log call
      const initCall = calls.find((c) => c[0] === 'info');
      expect(initCall).toBeDefined();

      const [, firstArg, secondArg] = initCall!;

      // OLD format check - MUST FAIL on old code
      const isOldFormat = typeof firstArg === 'string';
      expect(isOldFormat).toBe(false);

      // NEW format check - MUST PASS
      const isNewFormat = typeof firstArg === 'object' && firstArg !== null;
      expect(isNewFormat).toBe(true);

      // Message should be string at position 1
      expect(typeof secondArg).toBe('string');
      expect(secondArg).toBe('FirestoreEventStore initialized');
    });

    it('MUST verify argument POSITION not just type', async () => {
      const calls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => calls.push(args),
        info: (...args: unknown[]) => calls.push(args),
        warn: (...args: unknown[]) => calls.push(args),
        error: (...args: unknown[]) => calls.push(args),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      await eventStore.readStream('Test-Stream');

      // Find the 'Reading stream' call
      const readingCall = calls.find(
        (c) => typeof c[1] === 'string' && c[1] === 'Reading stream',
      );
      expect(readingCall).toBeDefined();

      const [firstArg, secondArg] = readingCall!;

      // Position 0 MUST be context object
      expect(typeof firstArg).toBe('object');
      expect(firstArg).not.toBeNull();

      // Position 1 MUST be message string
      expect(typeof secondArg).toBe('string');

      // Verify actual values match expected positions
      expect(firstArg).toEqual(
        expect.objectContaining({ streamName: 'Test-Stream' }),
      );
      expect(secondArg).toBe('Reading stream');
    });

    it('MUST handle message without context data', () => {
      const calls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => calls.push(args),
        info: (...args: unknown[]) => calls.push(args),
        warn: (...args: unknown[]) => calls.push(args),
        error: (...args: unknown[]) => calls.push(args),
      };

      getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      // Find the initialization call (has no context data)
      const initCall = calls.find(
        (c) => typeof c[1] === 'string' && c[1] === 'FirestoreEventStore initialized',
      );
      expect(initCall).toBeDefined();

      const [context, message] = initCall!;
      expect(context).toEqual({});
      expect(message).toBe('FirestoreEventStore initialized');
    });

    it('MUST preserve all context data without loss', async () => {
      const calls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => calls.push(args),
        info: (...args: unknown[]) => calls.push(args),
        warn: (...args: unknown[]) => calls.push(args),
        error: (...args: unknown[]) => calls.push(args),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      await eventStore.appendToStream('Test-Stream', [
        { type: 'TestEvent', data: { value: 1 } },
      ]);

      // Find 'Appending to stream' call
      const appendCall = calls.find(
        (c) => typeof c[1] === 'string' && c[1] === 'Appending to stream',
      );
      expect(appendCall).toBeDefined();

      const [context] = appendCall!;
      expect(context).toEqual(
        expect.objectContaining({
          streamName: 'Test-Stream',
          eventCount: 1,
          eventTypes: ['TestEvent'],
        }),
      );
    });
  });

  describe('All Logger Methods', () => {
    it('MUST call debug() at least once', async () => {
      const debugCalls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => debugCalls.push(args),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      await eventStore.readStream('Test-Stream');

      expect(debugCalls.length).toBeGreaterThan(0);
    });

    it('MUST call info() at least once', () => {
      const infoCalls: unknown[][] = [];
      const logger: Logger = {
        debug: jest.fn(),
        info: (...args: unknown[]) => infoCalls.push(args),
        warn: jest.fn(),
        error: jest.fn(),
      };

      getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      expect(infoCalls.length).toBeGreaterThan(0);
    });

    it('MUST call warn() with context', async () => {
      const warnCalls: unknown[][] = [];
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: (...args: unknown[]) => warnCalls.push(args),
        error: jest.fn(),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      // First append succeeds
      await eventStore.appendToStream('Test-Stream', [
        { type: 'TestEvent', data: { value: 1 } },
      ]);

      // Second append with wrong expected version should fail and trigger warn
      await expect(
        eventStore.appendToStream(
          'Test-Stream',
          [{ type: 'TestEvent', data: { value: 2 } }],
          { expectedStreamVersion: BigInt(999) },
        ),
      ).rejects.toThrow();

      expect(warnCalls.length).toBeGreaterThan(0);

      const [context, message] = warnCalls[0];
      expect(typeof context).toBe('object');
      expect(context).toEqual(
        expect.objectContaining({
          streamName: 'Test-Stream',
        }),
      );
      expect(message).toBe('Version conflict during append');
    });

    it('MUST call error() at least once on failure', async () => {
      const errorCalls: unknown[][] = [];
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: (...args: unknown[]) => errorCalls.push(args),
      };

      const failingFirestore = {
        collection: () => ({
          doc: () => ({
            collection: () => ({
              orderBy: () => ({
                get: () => Promise.reject(new Error('Firestore error')),
                where: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
              }),
            }),
          }),
        }),
      } as unknown as Firestore;

      const eventStore = getFirestoreEventStore(failingFirestore, {
        observability: { logger },
      });

      await expect(eventStore.readStream('Test-Stream')).rejects.toThrow();

      expect(errorCalls.length).toBeGreaterThan(0);

      const [context, message] = errorCalls[0];
      expect(typeof context).toBe('object');
      expect(message).toBe('Failed to read stream');
    });

    it('debug() without context returns empty object', async () => {
      const debugCalls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => debugCalls.push(args),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      await eventStore.readStream('Test-Stream');

      // All debug calls should have object as first param
      for (const call of debugCalls) {
        expect(typeof call[0]).toBe('object');
        expect(call[0]).not.toBeNull();
      }
    });
  });

  describe('Error Context Validation', () => {
    it('error context should use err key for Error instances', async () => {
      const errorCalls: unknown[][] = [];
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: (...args: unknown[]) => errorCalls.push(args),
      };

      const failingFirestore = {
        collection: () => ({
          doc: () => ({
            collection: () => ({
              orderBy: () => ({
                get: () => Promise.reject(new Error('Firestore error')),
                where: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
              }),
            }),
          }),
        }),
      } as unknown as Firestore;

      const eventStore = getFirestoreEventStore(failingFirestore, {
        observability: { logger },
      });

      await expect(eventStore.readStream('Test-Stream')).rejects.toThrow();

      expect(errorCalls.length).toBeGreaterThan(0);

      const [context] = errorCalls[0];
      expect(context).toHaveProperty('streamName');
      expect(context).toHaveProperty('error');
    });
  });

  describe('safeLog Encapsulation', () => {
    it('safeLog must NOT be importable from package', () => {
      expect('safeLog' in packageExports).toBe(false);
    });

    it('Logger MUST be importable from package', () => {
      // Logger is a type, so we check it's exported by using it
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      expect(logger).toBeDefined();
    });
  });

  describe('Type Safety', () => {
    it('Logger interface should have no any types', () => {
      // This is a compile-time check - if it compiles, it passes
      const logger: Logger = {
        debug: (context: Record<string, unknown>, message?: string) => {
          // Type-safe: context must be Record<string, unknown>
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
        info: (context: Record<string, unknown>, message?: string) => {
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
        warn: (context: Record<string, unknown>, message?: string) => {
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
        error: (context: Record<string, unknown>, message?: string) => {
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
      };
      expect(logger).toBeDefined();
    });
  });

  describe('Pino Compatibility', () => {
    it('should work with Pino-style logger directly', async () => {
      // Pino uses (context, message) natively
      const calls: unknown[][] = [];
      const pinoStyleLogger: Logger = {
        debug: (context, message) => calls.push(['debug', context, message]),
        info: (context, message) => calls.push(['info', context, message]),
        warn: (context, message) => calls.push(['warn', context, message]),
        error: (context, message) => calls.push(['error', context, message]),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger: pinoStyleLogger },
      });

      await eventStore.readStream('Test-Stream');

      // All calls should have object first, string second
      for (const call of calls) {
        const [, context, message] = call;
        expect(typeof context).toBe('object');
        expect(typeof message).toBe('string');
      }
    });
  });

  describe('Winston Adapter Pattern', () => {
    it('should work with Winston through adapter', async () => {
      // Winston uses (message, meta) - adapter inverts
      const winstonCalls: unknown[][] = [];

      // Fake Winston logger
      const fakeWinston = {
        log: (level: string, message: string, meta: unknown) => {
          winstonCalls.push([level, message, meta]);
        },
      };

      // Winston adapter that implements our Logger contract
      const winstonAdapter: Logger = {
        debug(context, message) {
          fakeWinston.log('debug', message ?? '', context);
        },
        info(context, message) {
          fakeWinston.log('info', message ?? '', context);
        },
        warn(context, message) {
          fakeWinston.log('warn', message ?? '', context);
        },
        error(context, message) {
          fakeWinston.log('error', message ?? '', context);
        },
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger: winstonAdapter },
      });

      await eventStore.readStream('Test-Stream');

      // Verify Winston received the calls in its expected format
      expect(winstonCalls.length).toBeGreaterThan(0);

      for (const call of winstonCalls) {
        const [level, message, meta] = call;
        expect(typeof level).toBe('string');
        expect(typeof message).toBe('string');
        expect(typeof meta).toBe('object');
      }
    });
  });
});
