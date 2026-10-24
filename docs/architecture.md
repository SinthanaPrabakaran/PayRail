# PayRail Architecture Document - Phase 3

## 1. System Vision
PayRail is a simulated fintech platform delivering core banking operations:
- Double-entry ledger with immutability guarantees
- Multi-currency digital wallets
- Simulated virtual and physical prepaid cards (authorization, clearing, freeze/unfreeze)
- Asynchronous transfer pipelines with idempotent execution
- Event-driven notifications via RabbitMQ

Phase 3 establishes an enterprise-grade, secure authentication system featuring Argon2id password hashing, short-lived JWT access tokens with issuer and audience constraints, token revocation via Redis blocklisting, normalized email lookups, and authenticated identity derivation.

---

## 2. Technology Stack & Decision Matrix
| Technology | Role | Justification |
| :--- | :--- | :--- |
| **Node.js LTS (v22+) & TypeScript** | Runtime & Language | Type safety with `strict: true`, modern async performance, wide library support |
| **Argon2id** | Password Hashing | Current cryptographic best practice for password hashing (winner of the Password Hashing Competition); resistant against GPU cracking and cache timing side-channels |
| **jsonwebtoken (JWT)** | Stateless Token Generation | Short-lived (15m), strict verification with `issuer`, `audience`, and unique token ID (`jti`) |
| **Redis Blocklist** | Revocation / Logout | Provides immediate token revocation without breaking the performance advantages of stateless JWTs |
| **Express.js & Helmet** | HTTP Security & Routing | Safe security headers, strict body limits (1MB), customizable CORS |
| **MongoDB 7.0 (Replica Set `rs0`)** | Datastore | Normalized unique lowercase email indexing, projection exclusion for password hashes |
| **Zod** | Input Validation | Strict schema enforcement on registration and login inputs before hitting controller logic |

---

## 3. Directory Layout (Phase 3)
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
│   │   ├── errorHandler.middleware.ts
│   │   ├── notFound.middleware.ts
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
│   │   ├── password.ts        # Argon2id hashing & verification
│   │   ├── token.ts           # JWT generation and verification
│   │   └── types.ts
│   ├── types/                 # Ambient TypeScript definitions
│   │   └── express.d.ts       # Express.Request.user augmentation
│   ├── workers/               # Background task consumers
│   │   └── notification.worker.ts
│   ├── app.ts                 # Express app factory
│   └── index.ts               # HTTP server bootstrap & graceful shutdown
├── tests/
│   ├── api.test.ts            # Route and error handler tests
│   ├── auth.test.ts           # Authentication & token revocation tests
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

## 4. Security Architecture & Tradeoffs

### 4.1 Argon2id for Password Hashing
- **Memory Cost**: 64 MB (`2^16` KB)
- **Time Cost**: 3 iterations
- **Parallelism**: 1 thread
- **Tradeoff**: Increases login computation time (~150ms) to deliberately maximize resistance against offline brute-force attacks via ASICs or GPUs.

### 4.2 Short-Lived JWTs + Redis Revocation (Hybrid Architecture)
- **Access Token TTL**: 15 minutes (`JWT_EXPIRES_IN=15m`).
- **Cryptographic Bounds**: Validates `iss` (issuer: `payrail-auth`), `aud` (audience: `payrail-api`), and expiration `exp`.
- **Claim Minimization**: Only includes non-sensitive identifiers (`sub`: userId, `email`, `role`, `jti`: tokenId). No sensitive PII or credentials.
- **Revocation**: When a user logs out (`POST /api/v1/auth/logout`), the token's `jti` is stored in Redis with a TTL equal to the token's remaining lifespan. The authentication middleware validates this blocklist on every incoming request.
- **Tradeoff**: Token verification requires a fast Redis lookup (~1ms) instead of being purely in-memory, but solves the classic JWT revocation limitation for fintech applications.

### 4.3 Identity Derivation & Zero-Trust Client IDs
- Client-supplied `userId` in path or body is **never trusted** to determine who is acting on an account.
- The acting user identity (`req.user.userId`) is derived exclusively from the verified token signature.

### 4.4 Defensive Error Handling & Anti-Enumeration
- Login failures return a generic `401 Unauthorized: Invalid email or password` whether the email doesn't exist or the password didn't match.
- Schema errors return structured 400 Bad Request responses without leaking server internals.
- User schema explicitly marks `passwordHash: { select: false }`, ensuring queries and serialization never leak password hashes into responses or log pipelines.
