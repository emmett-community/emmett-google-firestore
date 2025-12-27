import { getInMemoryMessageBus } from '@event-driven-io/emmett';
import { Firestore } from '@google-cloud/firestore';
import { getFirestoreEventStore } from '@emmett-community/emmett-google-firestore';
import {
  ApiE2ESpecification,
  createOpenApiValidatorOptions,
  expectResponse,
  getApplication,
  type ImportedHandlerModules,
  type TestRequest,
} from '@emmett-community/emmett-expressjs-with-openapi';
import { GenericContainer, Wait } from 'testcontainers';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ProductItem } from '../src/shoppingCarts/shoppingCart';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectId = 'demo-project';

let emulator: import('testcontainers').StartedTestContainer | null = null;
let emulatorHost = '';
let emulatorPort = 0;
let firestore: Firestore;
let given: ApiE2ESpecification;
let clientId: string;
let shoppingCartId: string;

const emulatorUrl = () => `http://${emulatorHost}:${emulatorPort}`;

const startEmulator = async () => {
  const container = await new GenericContainer('myfstartup/firebase-emulator-suite:15')
    .withPlatform('linux/amd64')
    .withExposedPorts(4000, 8080)
    .withBindMounts([
      {
        source: path.join(process.cwd(), 'test', 'support', 'firebase', 'firebase.json'),
        target: '/app/firebase.json',
        mode: 'ro' as const,
      },
      {
        source: path.join(process.cwd(), 'test', 'support', 'firebase', '.firebaserc'),
        target: '/app/.firebaserc',
        mode: 'ro' as const,
      },
    ])
    .withEnvironment({ PROJECT_ID: projectId })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();

  emulatorHost = container.getHost();
  emulatorPort = container.getMappedPort(8080);

  process.env.FIRESTORE_EMULATOR_HOST = `${emulatorHost}:${emulatorPort}`;
  process.env.FIRESTORE_PROJECT_ID = projectId;
  process.env.GCLOUD_PROJECT = projectId;

  return container;
};

const resetEmulator = async () => {
  const res = await fetch(
    `${emulatorUrl()}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );

  if (!res.ok) {
    throw new Error(`Failed to reset Firestore emulator: ${res.status} ${res.statusText}`);
  }
};

void describe('ShoppingCart e2e (OpenAPI)', () => {
  before(async () => {
    emulator = await startEmulator();

    firestore = new Firestore({
      projectId,
      host: `${emulatorHost}:${emulatorPort}`,
      ssl: false,
      customHeaders: {
        Authorization: 'Bearer owner',
      },
    });

    const eventStore = getFirestoreEventStore(firestore);
    const messageBus = getInMemoryMessageBus();
    const getUnitPrice = (_productId: string) => Promise.resolve(100);
    const getCurrentTime = () => new Date();

    given = ApiE2ESpecification.for(
      () => eventStore,
      () =>
        getApplication({
          openApiValidator: createOpenApiValidatorOptions(
            path.join(__dirname, '../src/openapi.yml'),
            {
              validateRequests: true,
              validateSecurity: true,
              validateResponses: false,
              operationHandlers: path.join(__dirname, '../src/handlers'),
              initializeHandlers: async (handlers?: ImportedHandlerModules) => {
                // Framework auto-imports handler modules!
                handlers!.shoppingCarts.initializeHandlers(
                  eventStore,
                  messageBus,
                  getUnitPrice,
                  getCurrentTime,
                );
              },
            },
          ),
        }),
    );
  });

  after(async () => {
    await firestore.terminate();
    if (emulator) {
      await emulator.stop();
    }
  });

  beforeEach(async () => {
    await resetEmulator();
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
  });

  const auth = (request: ReturnType<TestRequest>) =>
    request.set('Authorization', 'Bearer token-writer');

  void describe('When empty', () => {
    void it('adds product item', () => {
      return given()
        .when((request) =>
          auth(
            request
              .post(`/clients/${clientId}/shopping-carts/current/product-items`)
              .send(productItem),
          ),
        )
        .then([expectResponse(204)]);
    });

    void it('rejects invalid payload', () => {
      return given()
        .when((request) =>
          auth(
            request
              .post(`/clients/${clientId}/shopping-carts/current/product-items`)
              .send({ productId: 'test' }),
          ),
        )
        .then([expectResponse(400)]);
    });
  });

  void describe('When open', () => {
    const openedShoppingCart: TestRequest = (request) =>
      auth(
        request
          .post(`/clients/${clientId}/shopping-carts/current/product-items`)
          .send(productItem),
      );

    void it('confirms cart', () => {
      return given(openedShoppingCart)
        .when((request) =>
          auth(request.post(`/clients/${clientId}/shopping-carts/current/confirm`)),
        )
        .then([expectResponse(204)]);
    });

    void it('cancels cart', () => {
      return given(openedShoppingCart)
        .when((request) => auth(request.delete(`/clients/${clientId}/shopping-carts/current`)))
        .then([expectResponse(204)]);
    });

    void it('removes product', () => {
      return given(openedShoppingCart)
        .when((request) =>
          auth(
            request
              .delete(`/clients/${clientId}/shopping-carts/current/product-items`)
              .query({
                productId: productItem.productId,
                quantity: productItem.quantity,
                unitPrice: 100,
              }),
          ),
        )
        .then([expectResponse(204)]);
    });
  });

  void describe('OpenAPI/ security errors', () => {
    void it('requires auth', () => {
      return given()
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .send(productItem),
        )
        .then([expectResponse(401)]);
    });

    void it('validates query parameters', () => {
      return given()
        .when((request) =>
          auth(
            request
              .delete(`/clients/${clientId}/shopping-carts/current/product-items`)
              .query({ productId: 'test' }),
          ),
        )
        .then([expectResponse(400)]);
    });
  });

  const getRandomProduct = (): ProductItem => {
    return {
      productId: randomUUID(),
      quantity: Math.floor(Math.random() * 10) + 1,
    };
  };

  const productItem = getRandomProduct();
});
