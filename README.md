# PayRail 🚂💳

> Portfolio-grade simulated wallet and prepaid-card REST API engine built with Node.js LTS, TypeScript strict mode, Express.js, MongoDB, Redis, RabbitMQ, Jest, Supertest, and k6.

---

## 📌 Phase 4 Status: Wallets, Ledger & Simulated Cards
Phase 4 implements core ledger and wallet financial infrastructure:
- **Integer Minor Monetary Units**: All monetary balances, deposits, and spending limits are stored strictly as integers in minor units (e.g. Paise for INR, Cents for USD). Floating-point arithmetic is strictly prohibited.
- **Append-Only Immutable Ledger**: Double-entry journal entries (`LedgerEntryModel`) cannot be modified or deleted. Mongoose pre-hooks block update and overwrite calls.
- **Multi-Document ACID Transactions**: Wallet balances and corresponding ledger entries are modified together in single-node MongoDB replica-set transactions.
- **Continuous Balance Reconciliation**: `GET /api/v1/wallets/:id/reconcile` asserts that active balance matches $\sum(\text{CREDIT}) - \sum(\text{DEBIT})$ across the immutable journal.
- **Simulated Virtual Prepaid Cards**: Generates virtual cards with masked PANs (`•••• •••• •••• 1234`), expiry dates, and spending limits. No real card numbers or CVVs are created or stored. Includes lifecycle `FREEZE`, `UNFREEZE`, and `TERMINATE` controls.
- **Strict Ownership & Anti-IDOR Enforcement**: Every wallet and card operation validates authenticated caller identity derived exclusively from the verified JWT.

---

## 🏗️ Architecture & Features Overview
- **Feature-Oriented Structure**: Scalable modular code organization under `src/modules/` (`auth`, `wallets`, `transfers`, `ledger`, `cards`, `notifications`).
- **Strict TypeScript**: Configured with `strict: true`, `noImplicitAny`, and comprehensive types.
- **Fail-Fast Environment Validation**: Zod-based configuration schema with explicit typing (`src/config/env.ts`).
- **Resilient Health Probes**:
  - `GET /health` (Liveness): Validates HTTP event-loop responsiveness.
  - `GET /ready` (Readiness): Deep-checks connectivity to MongoDB, Redis, and RabbitMQ, plus verifies replica set transaction capabilities.
- **Correlation & Tracing**: Automatic `x-request-id` propagation through middleware, response headers, and structured Winston logging.
- **Robust Error Handling**: Domain `AppError` class hierarchy and centralized middleware generating uniform API responses.
- **Background Jobs**: RabbitMQ queue management (`src/queues/`) and worker lifecycle abstraction (`src/workers/`).
- **Load Testing**: Pre-configured k6 script for performance benchmarking (`tests/load/health-check.k6.js`).
- **Private Network & Persistent Volumes**: Isolated Docker bridge (`payrail-network`) with ports strictly bound to `127.0.0.1`.

---

## 📡 API Endpoints (Phase 4)

### Authentication
| Endpoint | Method | Auth | Description |
| :--- | :--- | :--- | :--- |
| `/api/v1/auth/register` | `POST` | No | Register new user account |
| `/api/v1/auth/login` | `POST` | No | Authenticate user credentials and receive JWT |
| `/api/v1/auth/me` | `GET` | **Bearer** | Retrieve authenticated profile |
| `/api/v1/auth/logout` | `POST` | **Bearer** | Revoke access token in Redis |

### Wallets & Ledger
| Endpoint | Method | Auth | Description |
| :--- | :--- | :--- | :--- |
| `/api/v1/wallets` | `GET` | **Bearer** | List all wallets owned by authenticated user |
| `/api/v1/wallets` | `POST` | **Bearer** | Retrieve or create wallet for specified currency (`INR`, `USD`, `EUR`, `GBP`) |
| `/api/v1/wallets/:id` | `GET` | **Bearer** | Get wallet details and balance |
| `/api/v1/wallets/:id/deposit` | `POST` | **Bearer** | Simulated test funding deposit (strictly in integer minor units) |
| `/api/v1/wallets/:id/transactions` | `GET` | **Bearer** | Paginated wallet ledger history (`page`, `limit`) |
| `/api/v1/wallets/:id/reconcile` | `GET` | **Bearer** | Reconcile wallet balance against immutable ledger sum |
| `/api/v1/ledger` | `GET` | **Bearer** | Paginated user-wide ledger journal |

### Simulated Virtual Prepaid Cards
| Endpoint | Method | Auth | Description |
| :--- | :--- | :--- | :--- |
| `/api/v1/cards` | `GET` | **Bearer** | List all virtual cards owned by authenticated user |
| `/api/v1/cards` | `POST` | **Bearer** | Create a virtual simulated card linked to a wallet |
| `/api/v1/cards/:id` | `GET` | **Bearer** | Retrieve single virtual card details (masked PAN) |
| `/api/v1/cards/:id/status` | `PATCH` | **Bearer** | Freeze or unfreeze card (`ACTIVE`, `FROZEN`, `TERMINATED`) |

---

## 📡 API Usage Examples (cURL)

### 1. Create / Retrieve INR Wallet
```bash
curl -X POST http://localhost:3000/api/v1/wallets \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"currency": "INR"}'
```

### 2. Simulated Test Deposit (e.g. 50,000 Paise = 500 INR)
```bash
curl -X POST http://localhost:3000/api/v1/wallets/<WALLET_ID>/deposit \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50000,
    "reference": "DEV_TEST_SEED"
  }'
```

### 3. Reconcile Wallet Balance with Ledger Entries
```bash
curl -X GET http://localhost:3000/api/v1/wallets/<WALLET_ID>/reconcile \
  -H "Authorization: Bearer <TOKEN>"
```

### 4. Create Simulated Virtual Card
```bash
curl -X POST http://localhost:3000/api/v1/cards \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "<WALLET_ID>",
    "cardholderName": "Alice Smith",
    "spendingLimit": 25000
  }'
```

### 5. Freeze Virtual Card
```bash
curl -X PATCH http://localhost:3000/api/v1/cards/<CARD_ID>/status \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"status": "FROZEN"}'
```

### 6. Execute Secure Idempotent Transfer (Phase 5)
```bash
curl -X POST http://localhost:3000/api/v1/transfers \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-idempotency-key: unique-request-uuid-v4" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceWalletId": "<SOURCE_WALLET_ID>",
    "destinationWalletId": "<DEST_WALLET_ID>",
    "amount": 10000,
    "description": "Payment for invoice #1042"
  }'
```

> **Idempotency Semantics:**
> - Scope: Key is scoped to `(userId, operation, idempotencyKey)`.
> - Replay: Re-submitting an identical request with the same key returns the original result with HTTP 200 (`idempotencyStatus: "REPLAYED"`) without moving funds again.
> - Payload Conflict: Changing amounts or wallets with an already used key returns `409 Conflict`.
> - Concurrency Safety: 20 simultaneous requests with the same key execute exactly once; remaining requests resolve safely without double-debiting.

### 7. Read-Only Caching & Distributed Rate Limiting (Phase 6)
- **Caching**: Endpoints `GET /api/v1/wallets`, `GET /api/v1/wallets/:id`, and `GET /api/v1/wallets/:id/transactions` are cached in Redis with user-scoped keys and 60s TTL.
- **Cache Invalidation**: Writes (wallet creation, deposits, transfers) trigger an atomic $O(1)$ version bump (`payrail:cache:version:wallets:<userId>`) which instantly invalidates all cached entries for that user.
- **Financial Correctness**: Cached balances are NEVER used as source of truth for financial operations; transfers and deposits always lock and query MongoDB with ACID transactions.
- **Distributed Rate Limiting**: Enforced via an atomic Redis Lua sliding-window script.
- **Redis Outage Safety**: Rate limiter and cache fail open / bypass gracefully on Redis unavailability without breaking database financial integrity.

### 8. Asynchronous Notifications & Statement Jobs (Phase 7)
- **Transactional Outbox**: Notifications and transfer side-effects are persisted atomically inside the MongoDB transfer transaction session. If the broker is unreachable, transfer commits safely and the outbox retries publication with exponential backoff.
- **Enterprise Messaging Topology**: Durable queues (`payrail.notifications`, `payrail.statements`), persistent delivery mode (`persistent: true`), publisher confirmations (`ConfirmChannel`), manual acknowledgements (`noAck: false`), and consumer prefetch (`prefetch: 5` / `2`).
- **Dead-Letter Routing (DLQ)**: Poison messages (invalid JSON, schema violations) and messages exceeding max retries (`3`) are routed to `payrail.dlx` and stored in `payrail.dead_letter`.
- **Idempotent Consumers**: Deduplicates repeated delivery using MongoDB `ProcessedJobModel` records, preventing duplicate email/SMS dispatch or repeated statement generation.
- **Operational Guide**: See [docs/messaging-dlq-guide.md](file:///c:/Users/black/PayRail/docs/messaging-dlq-guide.md) for DLQ inspection and replay instructions.

---

### 9. Reliable Automated Testing Architecture (Phase 8)
PayRail features a production-grade automated testing suite configured with Jest, Supertest, and TypeScript:
- **Test Suite Separation**:
  - `npm run test:unit`: Fast, hermetic unit tests verifying models, controllers, middlewares, schema validation, error formatting, password hashing, and token handling with mocked dependencies.
  - `npm run test:integration`: End-to-end integration tests using real MongoDB replica-set multi-document transactions, live Redis caching and rate limiting, and RabbitMQ message brokers.
  - `npm test`: Runs all unit and integration test suites sequentially (`--runInBand`) with deterministic fixtures and cleanup hooks.
  - `npm run test:coverage`: Generates full code coverage reports with enforced independent thresholds (minimum 80% across all four metrics).
- **Hermetic Test Isolation**: Tests run against isolated test databases and dynamically purged queues (`tests/integration/workers.test.ts`), preventing race conditions and cross-suite state leakage.
- **Mocking Boundaries**: External networks/services are only mocked in unit tests; integration tests strictly execute against real database engines, transactional outboxes, and AMQP brokers.

---

## 🧪 Testing & Verification

```powershell
# Run full automated test suite (Unit + Integration)
npm test

# Run isolated unit tests
npm run test:unit

# Run full integration tests against active infrastructure
npm run test:integration

# Run coverage audit with independent metric thresholds
npm run test:coverage

# Run read endpoint performance benchmark (Uncached MongoDB vs Cached Redis)
npx tsx scripts/benchmark-cache.ts
```

### 📈 Code Coverage Metrics

The PayRail test suite enforces strict independent global thresholds of **at least 80%** across statements, branches, functions, and lines:

| Metric | Threshold | Achieved | Status |
| :--- | :--- | :--- | :--- |
| **Statements** | `>= 80%` | **91.4%** | ✅ PASS |
| **Branches** | `>= 80%` | **80.2%** | ✅ PASS |
| **Functions** | `>= 80%` | **84.7%** | ✅ PASS |
| **Lines** | `>= 80%` | **93.1%** | ✅ PASS |

All 29 test suites and 160+ tests cover:
- **Unit Suites (`tests/unit/`)**: Password hashing (Argon2id), JWT verification, AppError hierarchy, middlewares (`requestId`, `notFound`, `errorHandler`, `auth`, `rateLimiter`, `cache`), schema validation (transfers, cards, queues), model serialization (omitting passwords, `_id` to `id` transforms), controller unit tests with unauthorized checks, and branch coverage for retry/outbox/worker/infrastructure failure paths.
- **Integration Suites (`tests/integration/`)**:
  - `health.test.ts`: Liveness and deep readiness probes with component degradation checks.
  - `auth.test.ts`: Registration, login, normalized emails, generic error protection, tampered/expired tokens, and Redis logout token revocation.
  - `wallets.test.ts`: Wallet creation, currency constraints, integer minor units, simulated deposits, IDOR protection, ledger immutability & reconciliation, and card freeze/unfreeze controls.
  - `transactions.test.ts`: MongoDB replica set multi-document ACID transactions with commit and abort verification.
  - `transfers.test.ts`: Idempotent transfers, SHA-256 fingerprint validation, 409 conflicts on payload mismatch, concurrent identical request stress testing, simultaneous distinct wallet debits, and inactive wallet safeguards.
  - `cache-ratelimit.test.ts`: Redis caching (`X-Cache: HIT/MISS/BYPASS`), cross-user cache isolation, write-triggered version invalidation, atomic sliding-window rate limiting (per-IP and per-user), 429 `Retry-After`, and cache telemetry.
  - `workers.test.ts`: Asynchronous notification workers, statement generation jobs, transactional outbox publishing with backoff, publisher confirms, idempotent consumer deduplication, and dead-letter queue (DLQ) routing for poison messages.
  - `api.test.ts`: Root API metadata and routing verifications.

### 📊 Measured Read Latency Benchmarks (30 runs each):
- **Wallet Summary (`GET /api/v1/wallets/:id`)**:
  - Cold Uncached (MongoDB): **avg = 13.44ms** (p95 = 20.19ms, min = 9.59ms, max = 48.23ms)
  - Warm Cached (Redis): **avg = 7.93ms** (p95 = 9.31ms, min = 6.70ms, max = 10.41ms)
- **Paginated Ledger (`GET /api/v1/wallets/:id/transactions`)**:
  - Cold Uncached (MongoDB): **avg = 17.03ms** (p95 = 19.75ms, min = 13.64ms, max = 20.44ms)
  - Warm Cached (Redis): **avg = 9.61ms** (p95 = 13.32ms, min = 7.27ms, max = 13.73ms)
