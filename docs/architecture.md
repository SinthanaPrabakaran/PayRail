# PayRail Architecture Document - Phase 1

## 1. System Vision
PayRail is a simulated fintech platform delivering core banking operations:
- Double-entry ledger with immutability guarantees
- Multi-currency digital wallets
- Simulated virtual and physical prepaid cards (authorization, clearing, freeze/unfreeze)
- Asynchronous transfer pipelines with idempotent execution
- Event-driven notifications via RabbitMQ

Phase 1 provides the production-grade foundation, architectural boundaries, observability, health probes, and runtime configurations.

## 2. Technology Stack & Decision Matrix
| Technology | Role | Justification |
| :--- | :--- | :--- |
| **Node.js LTS (v22+) & TypeScript** | Runtime & Language | Type safety with `strict: true`, modern async performance, wide library support |
| **Express.js** | HTTP Web Framework | Mature, flexible middleware pipeline, lightweight HTTP overhead |
| **MongoDB & Mongoose** | Primary Datastore | Document flexibility for account states, transaction metadata, and auditable event logs |
| **Redis (ioredis)** | Cache & Distributed Lock | Low latency idempotency keys, rate limiting, distributed locking for wallet balance checks |
| **RabbitMQ (amqplib)** | Event Bus & Message Broker | Guaranteed message delivery, dead-letter exchanges (DLX) for decoupled card and notification events |
| **Jest & Supertest** | Testing Suite | Fast unit and HTTP integration testing |
| **k6** | Performance & Load Testing | Scriptable JavaScript load tests for validating SLAs and latency percentiles |
| **Docker & Compose** | Containerization | Local parity with cloud environments and isolated dependencies |
| **AWS ECS / ALB** | Target Cloud Deployment | Containerized service target monitored via semantic `/health` and `/ready` endpoints |

## 3. Directory Layout (Feature-Oriented)
```
PayRail/
├── docs/                      # Architecture, ADRs, API specs
│   └── architecture.md
├── scripts/                   # DB migrations, seeding, dev tasks
│   └── seed.ts
├── src/
│   ├── config/                # Environment schema (Zod) and DB connectors
│   │   ├── env.ts
│   │   └── database.ts
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
│   │   ├── health.routes.ts   # /health and /ready probes
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
│   └── load/                  # k6 scripts
│       └── health-check.k6.js
├── docker-compose.yml         # Local stack (Mongo, Redis, RabbitMQ)
├── Dockerfile                 # Multi-stage production container build
├── jest.config.js             # Jest config
├── tsconfig.json              # TypeScript strict configuration
└── package.json
```

## 4. Cross-Cutting Concerns
1. **Request Correlation (`x-request-id`)**:
   - Each HTTP request is tagged with a UUID or adopts client-provided `x-request-id`.
   - Propagated to response headers, Winston logs, and error responses.
2. **Centralized Error Handling**:
   - Custom `AppError` taxonomy (`BadRequestError`, `UnauthorizedError`, `NotFoundError`, `ConflictError`, etc.).
   - Catches Zod validation errors and unhandled runtime exceptions with uniform JSON output.
3. **Health & Readiness Semantics**:
   - `GET /health` (Liveness): Returns `200 OK` if the process loop is responsive.
   - `GET /ready` (Readiness): Inspects connectivity to MongoDB, Redis, and RabbitMQ. Returns `503 Service Unavailable` if critical dependencies are down to prevent bad routing at ALB/ingress.
4. **Structured Logging**:
   - Winston logger formatted as JSON in production and colorized human-readable logs in development, avoiding leaky sensitive data.
