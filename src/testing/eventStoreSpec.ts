/**
 * Testing utilities for Firestore Event Store
 *
 * These utilities help set up and manage the Firestore Emulator
 * for testing purposes.
 */

import { Firestore } from '@google-cloud/firestore';
import type { FirestoreEventStore } from '../eventStore/types';
import { getFirestoreEventStore } from '../eventStore/firestoreEventStore';

/**
 * Configuration for Firestore test environment
 */
export interface FirestoreTestConfig {
  projectId?: string;
  host?: string;
  ssl?: boolean;
}

/**
 * Get a Firestore instance configured for the emulator
 *
 * @param config - Optional configuration override
 * @returns Configured Firestore instance
 *
 * @example
 * ```typescript
 * const firestore = getTestFirestore();
 * // Use firestore for testing
 * await firestore.terminate();
 * ```
 */
export function getTestFirestore(config?: FirestoreTestConfig): Firestore {
  const projectId = config?.projectId || process.env.FIRESTORE_PROJECT_ID || 'test-project';
  const host = config?.host || process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
  const ssl = config?.ssl ?? false;

  return new Firestore({
    projectId,
    host,
    ssl,
    customHeaders: {
      Authorization: 'Bearer owner',
    },
  });
}

/**
 * Get a test event store instance connected to the emulator
 *
 * @param config - Optional configuration override
 * @returns FirestoreEventStore instance for testing
 *
 * @example
 * ```typescript
 * const eventStore = getTestEventStore();
 * // Use eventStore for testing
 * ```
 */
export function getTestEventStore(config?: FirestoreTestConfig): FirestoreEventStore {
  const firestore = getTestFirestore(config);
  return getFirestoreEventStore(firestore);
}

/**
 * Clear all data from a Firestore instance
 * Useful for cleaning up between tests
 *
 * @param firestore - Firestore instance to clear
 * @param batchSize - Number of documents to delete per batch
 *
 * @example
 * ```typescript
 * beforeEach(async () => {
 *   await clearFirestore(firestore);
 * });
 * ```
 */
export async function clearFirestore(
  firestore: Firestore,
  batchSize = 100,
): Promise<void> {
  const collections = await firestore.listCollections();

  for (const collection of collections) {
    await deleteCollection(firestore, collection.id, batchSize);
  }
}

/**
 * Delete a specific collection from Firestore
 *
 * @param firestore - Firestore instance
 * @param collectionPath - Path to the collection to delete
 * @param batchSize - Number of documents to delete per batch
 */
export async function deleteCollection(
  firestore: Firestore,
  collectionPath: string,
  batchSize = 100,
): Promise<void> {
  const collectionRef = firestore.collection(collectionPath);
  const query = collectionRef.limit(batchSize);

  return new Promise((resolve, reject) => {
    void deleteQueryBatch(firestore, query, resolve, reject);
  });
}

async function deleteQueryBatch(
  firestore: Firestore,
  query: FirebaseFirestore.Query,
  resolve: () => void,
  reject: (error: Error) => void,
): Promise<void> {
  try {
    const snapshot = await query.get();

    if (snapshot.size === 0) {
      resolve();
      return;
    }

    const batch = firestore.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    process.nextTick(() => {
      void deleteQueryBatch(firestore, query, resolve, reject);
    });
  } catch (error) {
    reject(error as Error);
  }
}

/**
 * Wait for the Firestore emulator to be ready
 *
 * @param host - Emulator host (default: localhost:8080)
 * @param timeout - Maximum time to wait in milliseconds (default: 30000)
 * @param interval - Check interval in milliseconds (default: 100)
 * @returns Promise that resolves when emulator is ready
 *
 * @example
 * ```typescript
 * await waitForEmulator();
 * // Emulator is ready
 * ```
 */
export async function waitForEmulator(
  host = 'localhost:8080',
  timeout = 30000,
  interval = 100,
): Promise<void> {
  const startTime = Date.now();
  const firestore = new Firestore({
    projectId: 'test',
    host,
    ssl: false,
  });

  while (Date.now() - startTime < timeout) {
    try {
      await firestore.listCollections();
      await firestore.terminate();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  await firestore.terminate();
  throw new Error(`Firestore emulator not ready after ${timeout}ms`);
}

/**
 * Setup function for Jest/Vitest tests with Firestore emulator
 *
 * @returns Object with firestore instance and cleanup function
 *
 * @example
 * ```typescript
 * describe('My Tests', () => {
 *   const { firestore, cleanup } = setupFirestoreTests();
 *
 *   afterAll(cleanup);
 *
 *   beforeEach(async () => {
 *     await clearFirestore(firestore);
 *   });
 *
 *   it('should work', async () => {
 *     const eventStore = getFirestoreEventStore(firestore);
 *     // ... test code
 *   });
 * });
 * ```
 */
export function setupFirestoreTests(config?: FirestoreTestConfig): {
  firestore: Firestore;
  eventStore: FirestoreEventStore;
  cleanup: () => Promise<void>;
  clearData: () => Promise<void>;
} {
  const firestore = getTestFirestore(config);
  const eventStore = getFirestoreEventStore(firestore);

  const cleanup = async () => {
    await firestore.terminate();
  };

  const clearData = async () => {
    await clearFirestore(firestore);
  };

  return {
    firestore,
    eventStore,
    cleanup,
    clearData,
  };
}
