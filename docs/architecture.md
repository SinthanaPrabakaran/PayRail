# PayRail Architecture Document - Phase 2

## 1. System Vision
PayRail is a simulated fintech platform delivering core banking operations:
- Double-entry ledger with immutability guarantees
- Multi-currency digital wallets
- Simulated virtual and physical prepaid cards (authorization, clearing, freeze/unfreeze)
- Asynchronous transfer pipelines with idempotent execution
- Event-driven notifications via RabbitMQ

Phase 2 establishes robust, lifecycle-managed connections to external dependencies, single-node MongoDB replica-set initialization supporting multi-document ACID transactions, authenticated Redis caching, and management-enabled RabbitMQ message brokers.

---

## 2. Technology Stack & Decision Matrix
| Technology | Role | Justification |
| :--- | :--- | :--- |
| **Node.js LTS (v22+) & TypeScript** | Runtime & Language | Type safety with `strict: true`, modern async performance, wide library support |
| **Express.js** | HTTP Web Framework | Mature, flexible middleware pipeline, lightweight HTTP overhead |
| **MongoDB 7.0 (Replica Set `rs0`)** | Primary Datastore | Supports multi-document ACID transactions essential for atomic balance debit/credit entries |
| **Redis 7.2 (ioredis with Auth)** | Cache & Distributed Lock | Low latency idempotency keys, rate limiting, distributed locking with password authentication |
| **RabbitMQ 3.13 (Management UI)** | Event Bus & Message Broker | Guaranteed message delivery, dead-letter exchanges (DLX), AMQP channel pooling |
| **Jest & Supertest** | Testing Suite | Unit and HTTP integration tests with active connection disposal |
| **k6** | Performance & Load Testing | Scriptable JavaScript load tests for validating SLAs and latency percentiles |
| **Docker & Compose** | Containerization | Isolated bridge network (`payrail-network`), health checks, and persistent volumes |
| **AWS ECS / ALB** | Target Cloud Deployment | Monitored via semantic `/health` and deep `/ready` endpoints |

---

## 3. Directory Layout (Phase 2)
```
PayRail/
├── docs/                      # Architecture, ADRs, API specs
│   └── architecture.md
├── scripts/                   # DB migrations, seeding, replica-set init
│   ├── init-mongo-rs.sh       # Reproducible MongoDB replica set initiator
│   └── seed.ts
├── src/
│   ├── config/                # Environment schema (Zod) and lifecycle connectors
│   │   ├── env.ts             # Runtime Zod validation
│   │   ├── mongo.ts           # MongoConnectionManager (retries, transactions)
│   │   ├── redis.ts           # RedisConnectionManager (auth, retries)
│   │   ├── rabbitmq.ts        # RabbitMQConnectionManager (channel lifecycle)
│   │   └── database.ts        # Unified database/infrastructure facade
│   ├── middleware/            # Cross-cutting HTTP middlewares
│   │   ├── errorHandler.middleware.ts
│   │   ├── notFound.middleware.ts
│   │   ├── requestId.middleware.ts
│   │   └── requestLogger.middleware.ts
│   ├── modules/               # Feature-oriented domain modules
│   │   ├── auth/              # Authentication & API keys
│   │   ├── wallets/           # Wallet balance & management
│   │   ├── transfers/         # P2P and external transfers
│   │   ├── ledger/            # Immutable double-entry book
│   │   ├── cards/             # Prepaid card issuance and auth
│   │   └── notifications/     # Event-driven alert dispatch
│   ├── queues/                # RabbitMQ channels, queues, and publishers
│   │   └── queue.manager.ts
│   ├── routes/                # Central route aggregators
│   │   ├── health.routes.ts   # /health and deep /ready probes
│   │   └── v1.routes.ts       # /api/v1 mounts
│   ├── shared/                # Universal utilities, error models, logger
│   │   ├── errors.ts
│   │   ├── logger.ts
│   │   └── types.ts
│   ├── types/                 # Ambient TypeScript definitions
│   │   └── express.d.ts
│   ├── workers/               # Background task consumers
│   │   └── notification.worker.ts
│   ├── app.ts                 # Express app factory
│   └── index.ts               # HTTP server bootstrap & graceful shutdown
├── tests/
│   ├── api.test.ts            # Route and error handler tests
│   ├── health.test.ts         # Probe tests
│   ├── transactions.test.ts   # ACID transaction verification tests
│   └── load/                  # k6 scripts
│       └── health-check.k6.js
├── docker-compose.yml         # Local stack (Mongo RS, Redis Auth, RabbitMQ Mgmt)
├── Dockerfile                 # Multi-stage production container build
├── jest.config.js             # Jest config
├── tsconfig.json              # TypeScript strict configuration
└── package.json
```

---

## 4. Infrastructure & Lifecycle Architecture
1. **Isolated Private Network**:
   - Containers communicate across `payrail-network` bridge.
   - Ports are bound to `127.0.0.1` locally, preventing unwanted exposure outside localhost.
2. **MongoDB Replica Set & Transactions**:
   - Single-node replica set `rs0` configured via `scripts/init-mongo-rs.sh`.
   - Supports ACID multi-document transactions via `startSession()` and `startTransaction()`.
3. **Redis Authentication**:
   - Protected with `--requirepass` and persistent AOF (`appendonly: yes`).
4. **RabbitMQ Broker**:
   - Management plugin enabled with metrics UI at `127.0.0.1:15672`.
5. **Safe Startup & Bounded Retries**:
   - All connectors implement bounded exponential/incremental retries (5 attempts with backoff).
   - Server does not crash immediately if external services take a few seconds to initialize.
6. **Clean Resource Disposal**:
   - `SIGTERM` and `SIGINT` trigger clean shutdown: HTTP server stops accepting new connections, then active MongoDB sessions, Redis connections, and RabbitMQ channels are cleanly closed before exiting.
