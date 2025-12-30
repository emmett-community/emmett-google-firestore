import type { Firestore } from '@google-cloud/firestore';
import { getFirestoreEventStore, type Logger } from '../src';
import { InMemoryFirestore } from './support/inMemoryFirestore';

describe('Observability', () => {
  let firestore: InMemoryFirestore;

  beforeEach(() => {
    firestore = new InMemoryFirestore();
  });

  afterEach(async () => {
    await firestore.terminate();
  });

  describe('Default behavior (no observability configured)', () => {
    it('should not produce any console output', async () => {
      const consoleSpy = jest.spyOn(console, 'log');
      const consoleDebugSpy = jest.spyOn(console, 'debug');
      const consoleInfoSpy = jest.spyOn(console, 'info');
      const consoleWarnSpy = jest.spyOn(console, 'warn');
      const consoleErrorSpy = jest.spyOn(console, 'error');

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore);

      await eventStore.appendToStream('Test-1', [
        { type: 'TestEvent', data: { value: 1 } },
      ]);

      await eventStore.readStream('Test-1');

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      consoleDebugSpy.mockRestore();
      consoleInfoSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should behave identically to version without observability', async () => {
      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore);

      const result = await eventStore.appendToStream('Test-2', [
        { type: 'TestEvent', data: { value: 1 } },
      ]);

      expect(result.nextExpectedStreamVersion).toBe(BigInt(0));
      expect(result.createdNewStream).toBe(true);
    });
  });

  describe('Logger integration', () => {
    it('should call logger.info on initialization', () => {
      const logger: Logger = {
        info: jest.fn(),
        debug: jest.fn(),
      };

      getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      expect(logger.info).toHaveBeenCalledWith('FirestoreEventStore initialized', undefined);
    });

    it('should call logger.debug on readStream', async () => {
      const logger: Logger = {
        debug: jest.fn(),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      await eventStore.readStream('Test-Stream');

      expect(logger.debug).toHaveBeenCalledWith(
        'Reading stream',
        expect.objectContaining({ streamName: 'Test-Stream' }),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Stream read completed',
        expect.objectContaining({ streamName: 'Test-Stream', eventCount: 0 }),
      );
    });

    it('should call logger.debug on appendToStream', async () => {
      const logger: Logger = {
        debug: jest.fn(),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      await eventStore.appendToStream('Test-Stream', [
        { type: 'TestEvent', data: { value: 1 } },
      ]);

      expect(logger.debug).toHaveBeenCalledWith(
        'Appending to stream',
        expect.objectContaining({
          streamName: 'Test-Stream',
          eventCount: 1,
          eventTypes: ['TestEvent'],
        }),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Read stream metadata',
        expect.objectContaining({
          streamName: 'Test-Stream',
          exists: false,
        }),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Events written to transaction',
        expect.objectContaining({
          streamName: 'Test-Stream',
          count: 1,
        }),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Append completed',
        expect.objectContaining({
          streamName: 'Test-Stream',
          createdNewStream: true,
        }),
      );
    });

    it('should call logger.warn on version conflict', async () => {
      const logger: Logger = {
        debug: jest.fn(),
        warn: jest.fn(),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      // First append succeeds
      await eventStore.appendToStream('Test-Stream', [
        { type: 'TestEvent', data: { value: 1 } },
      ]);

      // Second append with wrong expected version should fail
      await expect(
        eventStore.appendToStream(
          'Test-Stream',
          [{ type: 'TestEvent', data: { value: 2 } }],
          { expectedStreamVersion: BigInt(999) },
        ),
      ).rejects.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        'Version conflict during append',
        expect.objectContaining({ streamName: 'Test-Stream' }),
      );
    });

    it('should call logger.error on failure', async () => {
      const logger: Logger = {
        debug: jest.fn(),
        error: jest.fn(),
      };

      // Create a mock firestore that throws on query
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

      await expect(eventStore.readStream('Test-Stream')).rejects.toThrow('Firestore error');

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to read stream',
        expect.objectContaining({ streamName: 'Test-Stream' }),
      );
    });

    it('should work with partial logger implementation (only info)', async () => {
      const logger: Logger = {
        info: jest.fn(),
        // debug, warn, error not implemented
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      // Should not throw even though debug is called internally
      await eventStore.appendToStream('Test-Stream', [
        { type: 'TestEvent', data: { value: 1 } },
      ]);

      expect(logger.info).toHaveBeenCalled();
    });

    it('should work with partial logger implementation (only debug)', async () => {
      const logger: Logger = {
        debug: jest.fn(),
        // info, warn, error not implemented
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      // Should not throw
      await eventStore.appendToStream('Test-Stream', [
        { type: 'TestEvent', data: { value: 1 } },
      ]);

      expect(logger.debug).toHaveBeenCalled();
    });

    it('should never log event payloads (data)', async () => {
      const logger: Logger = {
        info: jest.fn(),
        debug: jest.fn(),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      const sensitiveData = { password: 'secret123', creditCard: '1234-5678' };

      await eventStore.appendToStream('Test-Stream', [
        { type: 'SensitiveEvent', data: sensitiveData },
      ]);

      const allCalls = [
        ...(logger.info as jest.Mock).mock.calls,
        ...(logger.debug as jest.Mock).mock.calls,
      ];

      for (const call of allCalls) {
        const stringified = JSON.stringify(call);
        expect(stringified).not.toContain('secret123');
        expect(stringified).not.toContain('1234-5678');
      }
    });
  });
});
