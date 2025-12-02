import { Timestamp } from '@google-cloud/firestore';
import {
  padVersion,
  parseStreamName,
  timestampToDate,
  assertExpectedVersionMatchesCurrent,
  getCurrentStreamVersion,
  calculateNextVersion,
  ExpectedVersionConflictError,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  NO_CONCURRENCY_CHECK,
} from '../../src';

describe('Utility Functions', () => {
  describe('padVersion', () => {
    it('should pad version 0 correctly', () => {
      expect(padVersion(0)).toBe('0000000000');
    });

    it('should pad small version numbers', () => {
      expect(padVersion(1)).toBe('0000000001');
      expect(padVersion(42)).toBe('0000000042');
      expect(padVersion(999)).toBe('0000000999');
    });

    it('should pad medium version numbers', () => {
      expect(padVersion(12345)).toBe('0000012345');
      expect(padVersion(999999)).toBe('0000999999');
    });

    it('should handle large version numbers', () => {
      expect(padVersion(1234567890)).toBe('1234567890');
      expect(padVersion(9999999999)).toBe('9999999999');
    });

    it('should work with BigInt', () => {
      expect(padVersion(BigInt(0))).toBe('0000000000');
      expect(padVersion(BigInt(42))).toBe('0000000042');
      expect(padVersion(BigInt(1234567890))).toBe('1234567890');
    });

    it('should maintain ordering for sequential versions', () => {
      const versions = [0, 1, 2, 10, 100, 1000, 10000].map(padVersion);
      const sorted = [...versions].sort();
      expect(versions).toEqual(sorted);
    });
  });

  describe('parseStreamName', () => {
    it('should parse simple stream name', () => {
      const result = parseStreamName('User-123');
      expect(result).toEqual({
        streamType: 'User',
        streamId: '123',
      });
    });

    it('should parse stream name with UUID', () => {
      const result = parseStreamName('Order-550e8400-e29b-41d4-a716-446655440000');
      expect(result).toEqual({
        streamType: 'Order',
        streamId: '550e8400-e29b-41d4-a716-446655440000',
      });
    });

    it('should parse stream name with multiple dashes in ID', () => {
      const result = parseStreamName('ShoppingCart-user-123-cart-456');
      expect(result).toEqual({
        streamType: 'ShoppingCart',
        streamId: 'user-123-cart-456',
      });
    });

    it('should handle stream name without ID', () => {
      const result = parseStreamName('GlobalCounter');
      expect(result).toEqual({
        streamType: 'GlobalCounter',
        streamId: '',
      });
    });

    it('should handle empty string ID', () => {
      const result = parseStreamName('User-');
      expect(result).toEqual({
        streamType: 'User',
        streamId: '',
      });
    });
  });

  describe('timestampToDate', () => {
    it('should convert Firestore Timestamp to Date', () => {
      const now = new Date('2025-11-27T12:00:00.000Z');
      const timestamp = Timestamp.fromDate(now);
      const result = timestampToDate(timestamp);

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(now.getTime());
    });

    it('should handle timestamps with nanoseconds', () => {
      const timestamp = new Timestamp(1700000000, 123456789);
      const result = timestampToDate(timestamp);

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(timestamp.toMillis());
    });
  });

  describe('getCurrentStreamVersion', () => {
    it('should return STREAM_DOES_NOT_EXIST when stream does not exist', () => {
      const result = getCurrentStreamVersion(false);
      expect(result).toBe(STREAM_DOES_NOT_EXIST);
    });

    it('should return version when stream exists', () => {
      const result = getCurrentStreamVersion(true, 5);
      expect(result).toBe(BigInt(5));
    });

    it('should return 0 when stream exists with version 0', () => {
      const result = getCurrentStreamVersion(true, 0);
      expect(result).toBe(BigInt(0));
    });

    it('should return -1 when stream exists without version', () => {
      const result = getCurrentStreamVersion(true, undefined);
      expect(result).toBe(BigInt(-1));
    });
  });

  describe('calculateNextVersion', () => {
    it('should calculate next version for new stream', () => {
      const result = calculateNextVersion(STREAM_DOES_NOT_EXIST, 1);
      expect(result).toBe(BigInt(0));
    });

    it('should calculate next version for existing stream', () => {
      const result = calculateNextVersion(BigInt(5), 3);
      expect(result).toBe(BigInt(8));
    });

    it('should handle appending single event', () => {
      const result = calculateNextVersion(BigInt(0), 1);
      expect(result).toBe(BigInt(1));
    });

    it('should handle appending multiple events', () => {
      const result = calculateNextVersion(BigInt(10), 5);
      expect(result).toBe(BigInt(15));
    });
  });

  describe('assertExpectedVersionMatchesCurrent', () => {
    describe('with NO_CONCURRENCY_CHECK version', () => {
      it('should not throw for any current version', () => {
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', NO_CONCURRENCY_CHECK, BigInt(0)),
        ).not.toThrow();
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', NO_CONCURRENCY_CHECK, BigInt(100)),
        ).not.toThrow();
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', NO_CONCURRENCY_CHECK, STREAM_DOES_NOT_EXIST),
        ).not.toThrow();
      });
    });

    describe('with STREAM_DOES_NOT_EXIST expectation', () => {
      it('should not throw when stream does not exist', () => {
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', STREAM_DOES_NOT_EXIST, STREAM_DOES_NOT_EXIST),
        ).not.toThrow();
      });

      it('should throw when stream exists', () => {
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', STREAM_DOES_NOT_EXIST, BigInt(0)),
        ).toThrow(ExpectedVersionConflictError);
      });

      it('should throw with correct error details', () => {
        try {
          assertExpectedVersionMatchesCurrent('User-123', STREAM_DOES_NOT_EXIST, BigInt(5));
          fail('Should have thrown ExpectedVersionConflictError');
        } catch (error) {
          expect(error).toBeInstanceOf(ExpectedVersionConflictError);
          const e = error as ExpectedVersionConflictError;
          expect(e.streamName).toBe('User-123');
          expect(e.expected).toBe(STREAM_DOES_NOT_EXIST);
          expect(e.actual).toBe(BigInt(5));
        }
      });
    });

    describe('with STREAM_EXISTS expectation', () => {
      it('should not throw when stream exists', () => {
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', STREAM_EXISTS, BigInt(0)),
        ).not.toThrow();
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', STREAM_EXISTS, BigInt(100)),
        ).not.toThrow();
      });

      it('should throw when stream does not exist', () => {
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', STREAM_EXISTS, STREAM_DOES_NOT_EXIST),
        ).toThrow(ExpectedVersionConflictError);
      });
    });

    describe('with specific version expectation', () => {
      it('should not throw when versions match', () => {
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', BigInt(0), BigInt(0)),
        ).not.toThrow();
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', BigInt(42), BigInt(42)),
        ).not.toThrow();
      });

      it('should throw when versions do not match', () => {
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', BigInt(5), BigInt(10)),
        ).toThrow(ExpectedVersionConflictError);
      });

      it('should throw when stream does not exist', () => {
        expect(() =>
          assertExpectedVersionMatchesCurrent('stream-1', BigInt(0), STREAM_DOES_NOT_EXIST),
        ).toThrow(ExpectedVersionConflictError);
      });

      it('should throw with correct error details for mismatch', () => {
        try {
          assertExpectedVersionMatchesCurrent('Order-456', BigInt(10), BigInt(15));
          fail('Should have thrown ExpectedVersionConflictError');
        } catch (error) {
          expect(error).toBeInstanceOf(ExpectedVersionConflictError);
          const e = error as ExpectedVersionConflictError;
          expect(e.streamName).toBe('Order-456');
          expect(e.expected).toBe(BigInt(10));
          expect(e.actual).toBe(BigInt(15));
        }
      });
    });
  });

  describe('ExpectedVersionConflictError', () => {
    it('should create error with correct properties', () => {
      const error = new ExpectedVersionConflictError('stream-1', BigInt(5), BigInt(10));

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ExpectedVersionConflictError);
      expect(error.name).toBe('ExpectedVersionConflictError');
      expect(error.streamName).toBe('stream-1');
      expect(error.expected).toBe(BigInt(5));
      expect(error.actual).toBe(BigInt(10));
    });

    it('should have descriptive error message', () => {
      const error = new ExpectedVersionConflictError('User-123', BigInt(5), BigInt(10));
      expect(error.message).toContain('User-123');
      expect(error.message).toContain('5');
      expect(error.message).toContain('10');
    });

    it('should handle STREAM_DOES_NOT_EXIST in message', () => {
      const error = new ExpectedVersionConflictError('stream-1', STREAM_DOES_NOT_EXIST, BigInt(5));
      expect(error.message).toContain(STREAM_DOES_NOT_EXIST);
    });
  });
});
