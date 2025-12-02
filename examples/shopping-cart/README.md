# Shopping Cart Example - Emmett with Google Firestore

A complete shopping cart implementation using Event Sourcing with Emmett and Google Firestore.

## Features

- Event-sourced shopping cart
- Express.js API with OpenAPI specification
- Firestore event store
- Unit, integration, and E2E tests
- Docker Compose setup with Firestore emulator

## Running Locally

### Prerequisites

- Node.js >= 18
- Docker & Docker Compose
- Built `@emmett-community/emmett-google-firestore` package (run `npm run build` in repository root)

### Setup

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Start Firebase (Firestore + UI)**:

   ```bash
   docker-compose up firebase
   ```

   This starts:
   - Firestore emulator at <http://localhost:8080>
   - Firebase UI at <http://localhost:4000>

3. **Run the application** (in another terminal):

   ```bash
   FIRESTORE_EMULATOR_HOST=localhost:8080 npm run dev
   ```

The API will be available at `http://localhost:3000`.

## Visualizing Data

### Firebase UI (Visual Interface)

Open <http://localhost:4000> in your browser to access Firebase Emulator UI:

1. Click on the **"Firestore"** tab
2. You'll see the `streams` collection with cart metadata (version, timestamps)
3. Click on any stream document (e.g., `shopping_cart:test-client-1:current`)
4. **Important:** Firebase UI doesn't always show subcollections automatically
   - Look for a "Start collection" button or subcollections section
   - You may need to refresh the page
   - Type `events` manually in the path if needed

**Each stream has an `events` subcollection** containing:

- `type`: Event type (e.g., "ProductItemAddedToShoppingCart")
- `data`: Event payload with product details
- `streamVersion`: Version within the stream (0, 1, 2, ...)
- `globalPosition`: Global event position
- `timestamp`: When the event occurred

### Command Line (Alternative)

If Firebase UI doesn't show subcollections, verify events via REST API:

```bash
# List all carts
curl -s "http://localhost:8080/v1/projects/demo-project/databases/(default)/documents/streams" | python3 -m json.tool

# View events for a specific cart
curl -s "http://localhost:8080/v1/projects/demo-project/databases/(default)/documents/streams/shopping_cart:test-client-1:current/events" | python3 -m json.tool
```

## API Endpoints

### Add Product to Cart

```bash
POST /clients/{clientId}/shopping-carts/current/product-items
{
  "productId": "product-1",
  "quantity": 2
}
```

### Remove Product from Cart

```bash
DELETE /clients/{clientId}/shopping-carts/current/product-items
{
  "productId": "product-1",
  "quantity": 1,
  "unitPrice": 10.0
}
```

### Get Current Cart

```bash
GET /clients/{clientId}/shopping-carts/current
```

### Confirm Cart

```bash
POST /clients/{clientId}/shopping-carts/current/confirm
```

### Cancel Cart

```bash
DELETE /clients/{clientId}/shopping-carts/current
```

## Testing

### Unit Tests

```bash
npm run test:unit
```

### Integration Tests

Requires Firestore emulator running:

```bash
npm run test:integration
```

### E2E Tests

Requires both Firestore emulator and application running:

```bash
# Terminal 1: Start Firebase emulator
docker-compose up firebase

# Terminal 2: Start application
FIRESTORE_EMULATOR_HOST=localhost:8080 npm run dev

# Terminal 3: Run E2E tests
npm run test:e2e
```

### All Tests

```bash
npm test
```

## Example Usage

```bash
# Add product to cart
curl -X POST http://localhost:3000/clients/client-1/shopping-carts/current/product-items \
  -H "Content-Type: application/json" \
  -d '{"productId": "product-1", "quantity": 2}'

# Get cart
curl http://localhost:3000/clients/client-1/shopping-carts/current

# Confirm cart
curl -X POST http://localhost:3000/clients/client-1/shopping-carts/current/confirm
```

## Architecture

This example demonstrates:

- **Event Sourcing**: All state changes are stored as immutable events
- **CQRS**: Separate command (write) and query (read) models
- **Domain-Driven Design**: Clear separation of business logic
- **OpenAPI**: API specification and validation
- **Firestore**: Native Google Cloud database for event storage

## Project Structure

``` bash
examples/shopping-cart/
├── src/
│   ├── handlers/
│   │   └── shoppingCarts.ts     # Express handlers
│   ├── shoppingCarts/
│   │   ├── shoppingCart.ts      # Domain types
│   │   └── businessLogic.ts     # Event sourcing logic
│   └── index.ts                 # Application entry point
├── test/
│   ├── businessLogic.unit.spec.ts    # Unit tests
│   ├── handlers.int.spec.ts          # Integration tests with emulator
│   └── handlers.e2e.spec.ts          # End-to-end tests
├── openapi.yml                  # OpenAPI specification
├── docker-compose.yml           # Docker Compose configuration
├── Dockerfile.firebase          # Firebase emulator image
└── firebase.json                # Firebase configuration
```

## Environment Variables

- `PORT`: Application port (default: 3000)
- `FIRESTORE_PROJECT_ID`: Firestore project ID (default: demo-project)
- `FIRESTORE_EMULATOR_HOST`: Firestore emulator host (default: none, uses emulator if set)

## Learn More

- [Emmett Documentation](https://event-driven-io.github.io/emmett/)
- [Google Firestore Documentation](https://cloud.google.com/firestore/docs)
- [Event Sourcing Guide](https://event-driven.io/en/event_sourcing_basics/)
