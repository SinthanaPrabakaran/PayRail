# PayRail Architecture Document - Phase 4

## 1. System Vision
PayRail is a simulated fintech platform delivering core banking operations:
- Double-entry ledger with immutability guarantees
- Multi-currency digital wallets
- Simulated virtual and physical prepaid cards (authorization, clearing, freeze/unfreeze)
- Asynchronous transfer pipelines with idempotent execution
- Event-driven notifications via RabbitMQ

Phase 4 delivers core multi-currency digital wallets, immutable append-only ledger entries with double-entry balance reconciliation, and simulated virtual prepaid cards with lifecycle freeze/unfreeze controls.

---

## 2. Monetary & Ledger Model

### 2.1 Integer Minor Units (Paise, Cents)
- **Zero Floating-Point Arithmetic**: Storing currency as decimal/float types introduces IEEE 754 precision artifacts (e.g. `0.1 + 0.2 = 0.30000000000000004`).
- All monetary fields in PayRail (`balance`, `amount`, `spendingLimit`) are strictly defined and validated as **integers representing the lowest minor denomination** (e.g., INR: Paise, USD: Cents, EUR: Cents).
- Schema validation enforces `Number.isInteger` at both the Mongoose model layer and Zod input parser.

### 2.2 Double-Entry Ledger Invariants
1. **Append-Only Immutability**:
   - The `LedgerEntry` collection does not accept updates or deletes.
   - Mongoose pre-hooks block `updateOne`, `updateMany`, and `findOneAndUpdate` operations.
2. **Atomic Multi-Document ACID Transactions**:
   - Wallet balance modifications and corresponding ledger journal entries are committed together inside a single MongoDB replica-set transaction session.
   - If an entry fails or balance check violates non-negative constraints, the entire transaction rolls back.
3. **Continuous Reconciliation Invariant**:
   - For every wallet, the active balance must strictly equal:
     $$\text{Balance} = \sum(\text{CREDIT}) - \sum(\text{DEBIT})$$
   - Dedicated endpoint `GET /api/v1/wallets/:id/reconcile` dynamically evaluates this equation over the immutable journal.

### 2.3 Simulated Virtual Prepaid Cards
- Virtual card records represent simulated prepaid debit accounts attached to a user's wallet.
- **Card Security**: No real card numbers (PANs) or CVVs are generated or stored. Cards store only a masked display representation (`•••• •••• •••• 1234`) and simulated expiration dates.
- **Card Status Machine**:
  - `ACTIVE`: Eligible for simulated authorization.
  - `FROZEN`: Temporarily locked by user.
  - `TERMINATED`: Permanently deactivated.
- **Simulated Designation**: Marked with `isSimulated: true`. No real card networks (Visa/Mastercard) or payment gateways are touched.

---

## 3. Directory Layout (Phase 4)
```
PayRail/
├── docs/                      # Architecture, ADRs, API specs
│   └── architecture.md
├── scripts/                   # DB migrations, seeding, replica-set init
│   ├── init-mongo-rs.sh       # MongoDB replica set initiator
│   └── seed.ts
├── src/
│   ├── config/                # Environment schema (Zod) and lifecycle connectors
│   │   ├── env.ts             # Runtime Zod validation with JWT settings
│   │   ├── mongo.ts           # MongoConnectionManager (retries, transactions)
│   │   ├── redis.ts           # RedisConnectionManager (auth, retries)
│   │   ├── rabbitmq.ts        # RabbitMQConnectionManager (channel lifecycle)
│   │   └── database.ts        # Unified database/infrastructure facade
│   ├── middleware/            # Cross-cutting HTTP middlewares
│   │   ├── auth.middleware.ts # JWT verification & Redis revocation check
│   │   ├── cache.middleware.ts# User-scoped versioned caching & telemetry
│   │   ├── errorHandler.middleware.ts
│   │   ├── notFound.middleware.ts
│   │   ├── rateLimiter.middleware.ts # Atomic Redis Lua sliding window limiter
│   │   ├── requestId.middleware.ts
│   │   └── requestLogger.middleware.ts
│   ├── modules/               # Feature-oriented domain modules
│   │   ├── auth/              # Authentication & User Management
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.schema.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── tokenRevocation.service.ts
│   │   │   └── user.model.ts
│   │   ├── wallets/           # Wallet balance & management
│   │   │   ├── wallet.controller.ts
│   │   │   ├── wallet.model.ts
│   │   │   ├── wallet.schema.ts
│   │   │   ├── wallet.service.ts
│   │   │   └── wallets.routes.ts
│   │   ├── ledger/            # Immutable double-entry book
│   │   │   ├── ledger.model.ts
│   │   │   └── ledger.routes.ts
│   │   ├── cards/             # Simulated prepaid cards
│   │   │   ├── card.controller.ts
│   │   │   ├── card.model.ts
│   │   │   ├── card.schema.ts
│   │   │   ├── card.service.ts
│   │   │   └── cards.routes.ts
│   │   ├── transfers/         # P2P and external transfers
│   │   │   ├── idempotency.model.ts
│   │   │   ├── transfer.controller.ts
│   │   │   ├── transfer.model.ts
│   │   │   ├── transfer.schema.ts
│   │   │   ├── transfer.service.ts
│   │   │   └── transfers.routes.ts
│   │   └── notifications/     # Event-driven alert dispatch
│   ├── queues/                # RabbitMQ channels, queues, and publishers
│   │   └── queue.manager.ts
│   ├── routes/                # Central route aggregators
│   │   ├── health.routes.ts   # /health and deep /ready probes
│   │   └── v1.routes.ts       # /api/v1 mounts
│   ├── shared/                # Universal utilities, error models, logger
│   │   ├── errors.ts
│   │   ├── logger.ts
│   │   ├── password.ts        # Argon2id hashing & verification
│   │   ├── token.ts           # JWT generation and verification
│   │   └── types.ts
│   ├── types/                 # Ambient TypeScript definitions
│   │   └── express.d.ts       # Express.Request.user augmentation
│   ├── workers/               # Background task consumers
│   │   └── notification.worker.ts
│   ├── app.ts                 # Express app factory
│   └── index.ts               # HTTP server bootstrap & graceful shutdown
├── scripts/
│   └── benchmark-cache.ts     # Repeatable read latency benchmark harness
├── tests/
│   ├── api.test.ts            # Route and error handler tests
│   ├── auth.test.ts           # Authentication & token revocation tests
│   ├── cache-ratelimit.test.ts# Phase 6 Cache & sliding-window rate limit tests
│   ├── health.test.ts         # Probe tests
│   ├── transactions.test.ts   # ACID transaction verification tests
│   ├── transfers.test.ts      # Phase 5 Idempotent transfer & concurrency stress tests
│   ├── wallets.test.ts        # Phase 4 Wallets, Ledger & Cards tests
│   └── load/                  # k6 scripts
│       └── health-check.k6.js
├── docker-compose.yml         # Local stack (Mongo RS, Redis Auth, RabbitMQ Mgmt)
├── Dockerfile                 # Multi-stage production container build
├── jest.config.js             # Jest config
├── tsconfig.json              # TypeScript strict configuration
└── package.json
```
