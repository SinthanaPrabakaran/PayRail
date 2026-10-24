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

---

## 🧪 Testing

```powershell
npm test
```
All 47 tests across 6 test suites pass cleanly:
- `tests/transfers.test.ts`: Phase 5 idempotent transfers, fingerprint validation, 409 conflicts on mismatch, 20 concurrent identical request stress test, and simultaneous distinct wallet debits.
- `tests/wallets.test.ts`: Wallet creation, currency constraints, integer minor units, simulated deposits, IDOR protection, ledger immutability & reconciliation, and card freeze/unfreeze controls.
- `tests/auth.test.ts`: Registration, login, normalized emails, generic errors, tampered/expired tokens, and Redis logout revocation.
- `tests/transactions.test.ts`: MongoDB replica set multi-document ACID transactions with commit/abort.
- `tests/health.test.ts`: Liveness and deep readiness probes.
- `tests/api.test.ts`: Route definitions and error handling.
