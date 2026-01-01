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
    it('should call logger.info on initialization with (context, message) format', () => {
      const logger: Logger = {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      // New format: (context, message)
      expect(logger.info).toHaveBeenCalledWith({}, 'FirestoreEventStore initialized');
    });

    it('should call logger.debug on readStream with (context, message) format', async () => {
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      await eventStore.readStream('Test-Stream');

      // New format: (context, message)
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ streamName: 'Test-Stream' }),
        'Reading stream',
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ streamName: 'Test-Stream', eventCount: 0 }),
        'Stream read completed',
      );
    });

    it('should call logger.debug on appendToStream with (context, message) format', async () => {
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const eventStore = getFirestoreEventStore(firestore as unknown as Firestore, {
        observability: { logger },
      });

      await eventStore.appendToStream('Test-Stream', [
        { type: 'TestEvent', data: { value: 1 } },
      ]);

      // New format: (context, message)
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          streamName: 'Test-Stream',
          eventCount: 1,
          eventTypes: ['TestEvent'],
        }),
        'Appending to stream',
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          streamName: 'Test-Stream',
          exists: false,
        }),
        'Read stream metadata',
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          streamName: 'Test-Stream',
          count: 1,
        }),
        'Events written to transaction',
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          streamName: 'Test-Stream',
          createdNewStream: true,
        }),
        'Append completed',
      );
    });

    it('should call logger.warn on version conflict with (context, message) format', async () => {
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
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

      // New format: (context, message)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ streamName: 'Test-Stream' }),
        'Version conflict during append',
      );
    });

    it('should call logger.error on failure with (context, message) format', async () => {
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
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

      // New format: (context, message)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ streamName: 'Test-Stream' }),
        'Failed to read stream',
      );
    });

    it('should never log event payloads (data)', async () => {
      const logger: Logger = {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
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
