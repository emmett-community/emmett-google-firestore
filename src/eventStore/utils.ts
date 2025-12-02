import type { Timestamp } from '@google-cloud/firestore';
import type { ExpectedStreamVersion } from './types';
import {
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  NO_CONCURRENCY_CHECK,
  ExpectedVersionConflictError,
} from './types';

/**
 * Pad version number with leading zeros for Firestore document IDs
 * This ensures automatic ordering by version in Firestore
 *
 * @param version - The version number to pad
 * @returns Zero-padded string of length 10
 *
 * @example
 * padVersion(0) // "0000000000"
 * padVersion(42) // "0000000042"
 * padVersion(12345) // "0000012345"
 */
export function padVersion(version: number | bigint): string {
  return version.toString().padStart(10, '0');
}

/**
 * Parse a stream name into type and ID components
 *
 * @param streamName - Stream name in format "Type-id" or "Type-with-dashes-id"
 * @returns Object with streamType and streamId
 *
 * @example
 * parseStreamName("User-123") // { streamType: "User", streamId: "123" }
 * parseStreamName("ShoppingCart-abc-def-123") // { streamType: "ShoppingCart", streamId: "abc-def-123" }
 */
export function parseStreamName(streamName: string): {
  streamType: string;
  streamId: string;
} {
  const firstDashIndex = streamName.indexOf('-');

  if (firstDashIndex === -1) {
    return {
      streamType: streamName,
      streamId: '',
    };
  }

  return {
    streamType: streamName.substring(0, firstDashIndex),
    streamId: streamName.substring(firstDashIndex + 1),
  };
}

/**
 * Convert Firestore Timestamp to JavaScript Date
 *
 * @param timestamp - Firestore Timestamp
 * @returns JavaScript Date object
 */
export function timestampToDate(timestamp: Timestamp): Date {
  return timestamp.toDate();
}

/**
 * Validate expected version against current version
 *
 * @param streamName - Stream name for error messages
 * @param expectedVersion - Expected version constraint
 * @param currentVersion - Current stream version (or STREAM_DOES_NOT_EXIST if stream doesn't exist)
 * @throws ExpectedVersionConflictError if versions don't match
 */
export function assertExpectedVersionMatchesCurrent(
  streamName: string,
  expectedVersion: ExpectedStreamVersion,
  currentVersion: bigint | typeof STREAM_DOES_NOT_EXIST,
): void {
  // NO_CONCURRENCY_CHECK - no validation needed
  if (expectedVersion === NO_CONCURRENCY_CHECK) {
    return;
  }

  // STREAM_DOES_NOT_EXIST - stream must not exist
  if (expectedVersion === STREAM_DOES_NOT_EXIST) {
    if (currentVersion !== STREAM_DOES_NOT_EXIST) {
      throw new ExpectedVersionConflictError(
        streamName,
        expectedVersion,
        currentVersion,
      );
    }
    return;
  }

  // STREAM_EXISTS - stream must exist
  if (expectedVersion === STREAM_EXISTS) {
    if (currentVersion === STREAM_DOES_NOT_EXIST) {
      throw new ExpectedVersionConflictError(
        streamName,
        expectedVersion,
        currentVersion,
      );
    }
    return;
  }

  // Specific version number
  const expectedBigInt = BigInt(expectedVersion);
  if (currentVersion === STREAM_DOES_NOT_EXIST || currentVersion !== expectedBigInt) {
    throw new ExpectedVersionConflictError(
      streamName,
      expectedVersion,
      currentVersion,
    );
  }
}

/**
 * Get the current stream version from metadata
 *
 * @param streamExists - Whether the stream document exists
 * @param version - Version number from Firestore (if stream exists)
 * @returns Current version as bigint or STREAM_DOES_NOT_EXIST
 */
export function getCurrentStreamVersion(
  streamExists: boolean,
  version?: number,
): bigint | typeof STREAM_DOES_NOT_EXIST {
  if (!streamExists) {
    return STREAM_DOES_NOT_EXIST;
  }
  return BigInt(version ?? -1);
}

/**
 * Calculate the next expected stream version after appending events
 *
 * @param currentVersion - Current stream version
 * @param eventCount - Number of events being appended
 * @returns Next expected version as bigint
 */
export function calculateNextVersion(
  currentVersion: bigint | typeof STREAM_DOES_NOT_EXIST,
  eventCount: number,
): bigint {
  if (currentVersion === STREAM_DOES_NOT_EXIST) {
    return BigInt(eventCount - 1);
  }
  // Type assertion needed because TypeScript doesn't narrow ExpectedStreamVersionGeneral properly
  return (currentVersion as bigint) + BigInt(eventCount);
}
