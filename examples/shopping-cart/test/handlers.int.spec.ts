import { getInMemoryMessageBus } from '@event-driven-io/emmett';
import { Firestore } from '@google-cloud/firestore';
import { getFirestoreEventStore } from '@emmett-community/emmett-google-firestore';
import {
  ApiSpecification,
  createOpenApiValidatorOptions,
  existingStream,
  expectError,
  expectNewEvents,
  expectResponse,
  getApplication,
  type ImportedHandlerModules,
} from '@emmett-community/emmett-expressjs-with-openapi';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type PricedProductItem,
  type ShoppingCartEvent,
} from '../src/shoppingCarts/shoppingCart';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authHeader = ['Authorization', 'Bearer token-writer'] as const;
const getUnitPrice = (_productId: string) => Promise.resolve(100);

void describe('ShoppingCart integration (OpenAPI)', () => {
  let clientId: string;
  let shoppingCartId: string;
  const messageBus = getInMemoryMessageBus();
  const oldTime = new Date();
  const now = new Date();

  beforeEach(() => {
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
  });

  void describe('When empty', () => {
    void it('adds product item', () => {
      return given()
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .set(...authHeader)
            .send(productItem),
        )
        .then([
          expectNewEvents(shoppingCartId, [
            {
              type: 'ProductItemAddedToShoppingCart',
              data: {
                shoppingCartId,
                clientId,
                productItem,
                addedAt: now,
              },
              metadata: { clientId },
            },
          ]),
        ]);
    });

    void it('rejects missing auth header', () => {
      return given()
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .send(productItem),
        )
        .then([
          expectError(401, {
            title: 'Unauthorized',
            status: 401,
          }),
        ]);
    });
  });

  void describe('When opened with product item', () => {
    void it('confirms cart', () => {
      return given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem,
              addedAt: oldTime,
            },
            metadata: { clientId },
          },
        ]),
      )
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/confirm`)
            .set(...authHeader),
        )
        .then([
          expectResponse(204),
          expectNewEvents(shoppingCartId, [
            {
              type: 'ShoppingCartConfirmed',
              data: {
                shoppingCartId,
                confirmedAt: now,
              },
              metadata: { clientId },
            },
          ]),
        ]);
    });

    void it('removes product item', () => {
      return given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem,
              addedAt: oldTime,
            },
            metadata: { clientId },
          },
        ]),
      )
        .when((request) =>
          request
            .delete(`/clients/${clientId}/shopping-carts/current/product-items`)
            .set(...authHeader)
            .query({
              productId: productItem.productId,
              quantity: productItem.quantity,
              unitPrice: productItem.unitPrice,
            }),
        )
        .then([
          expectResponse(204),
          expectNewEvents(shoppingCartId, [
            {
              type: 'ProductItemRemovedFromShoppingCart',
              data: {
                shoppingCartId,
                productItem,
                removedAt: now,
              },
              metadata: { clientId },
            },
          ]),
        ]);
    });

    void it('cancels cart', () => {
      return given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem,
              addedAt: oldTime,
            },
            metadata: { clientId },
          },
        ]),
      )
        .when((request) =>
          request
            .delete(`/clients/${clientId}/shopping-carts/current`)
            .set(...authHeader),
        )
        .then([
          expectResponse(204),
          expectNewEvents(shoppingCartId, [
            {
              type: 'ShoppingCartCancelled',
              data: {
                shoppingCartId,
                cancelledAt: now,
              },
              metadata: { clientId },
            },
          ]),
        ]);
    });
  });

  void describe('When confirmed', () => {
    void it('blocks adding items', () => {
      return given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem,
              addedAt: oldTime,
            },
            metadata: { clientId },
          },
          {
            type: 'ShoppingCartConfirmed',
            data: { shoppingCartId, confirmedAt: oldTime },
            metadata: { clientId },
          },
        ]),
      )
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .set(...authHeader)
            .send(productItem),
        )
        .then(
          expectError(403, {
            detail: 'CART_CLOSED',
            status: 403,
            title: 'Forbidden',
            type: 'about:blank',
          }),
        );
    });
  });

  const firestore = new Firestore({
    projectId: 'demo-project',
    host: process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080',
    ssl: false,
    customHeaders: {
      Authorization: 'Bearer owner',
    },
  });

  const given = ApiSpecification.for<ShoppingCartEvent>(
    () => getFirestoreEventStore(firestore),
    (eventStore) => {
      return getApplication({
        openApiValidator: createOpenApiValidatorOptions(
          path.join(__dirname, '../openapi.yml'),
          {
            validateRequests: true,
            validateSecurity: true,
            validateResponses: false,
            operationHandlers: path.join(__dirname, '../src/handlers'),
            initializeHandlers: async (handlers?: ImportedHandlerModules) => {
              // Framework auto-imports handler modules!
              handlers!.shoppingCarts.initializeHandlers(eventStore, messageBus, getUnitPrice, () => now);
            },
          },
        ),
      });
    },
  );

  const getRandomProduct = (): PricedProductItem => {
    return {
      productId: randomUUID(),
      unitPrice: 100,
      quantity: Math.floor(Math.random() * 10) + 1,
    };
  };

  const productItem = getRandomProduct();
});
