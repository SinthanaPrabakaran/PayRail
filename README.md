# PayRail 🚂💳

> Portfolio-grade simulated wallet and prepaid-card REST API engine built with Node.js LTS, TypeScript strict mode, Express.js, MongoDB, Redis, RabbitMQ, Jest, Supertest, and k6.

---

## 📌 Phase 3 Status: Secure Authentication
Phase 3 establishes an enterprise-grade authentication foundation:
- **Argon2id Password Hashing**: Cryptographically modern parameters (64MB memory cost, 3 iterations) resisting GPU and cache timing attacks.
- **Stateless Short-Lived JWT Access Tokens**: 15-minute expiration, validating `issuer` (`payrail-auth`), `audience` (`payrail-api`), and signed using private secrets.
- **Redis Token Blocklist (Revocation)**: `POST /api/v1/auth/logout` revokes tokens in Redis matching the remaining JWT lifespan.
- **Zero-Trust Identity Derivation**: User profile and access control derive strictly from authenticated JWT context, never trusting client-provided `userId` parameters.
- **Defensive Error Handling**: Generic `401 Unauthorized` responses mitigate user enumeration.
- **Strict Input Validation**: Zod schemas validate registration (complexity constraints) and login with lowercase email normalization.

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

## 📡 Authentication API Examples

### 1. Register User
`POST /api/v1/auth/register`
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "Password123!",
    "firstName": "Alice",
    "lastName": "Smith"
  }'
```
**Response (201 Created):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": "671ad203e3c09b...",
      "email": "alice@example.com",
      "firstName": "Alice",
      "lastName": "Smith",
      "role": "user",
      "createdAt": "2026-10-24T14:40:00.000Z"
    },
    "token": "eyJhbGciOi...",
    "expiresIn": "15m"
  },
  "meta": {
    "requestId": "4d16616a-...",
    "timestamp": "2026-10-24T14:40:00.000Z"
  }
}
```

### 2. Login User
`POST /api/v1/auth/login`
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "Password123!"
  }'
```

### 3. Get Authenticated Profile
`GET /api/v1/auth/me`
```bash
curl -X GET http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer <TOKEN>"
```

### 4. Logout / Token Revocation
`POST /api/v1/auth/logout`
```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer <TOKEN>"
```
*Subsequent requests using the revoked token will receive `401 Unauthorized: Token has been revoked`.*

---

## 🚀 Infrastructure Management Commands

### 1. Start Services
To start MongoDB (replica set), Redis (authenticated), and RabbitMQ in the background:
```powershell
docker compose up -d
```

### 2. Inspect Running Services & Health Checks
```powershell
docker compose ps
```
To view health logs for individual services:
```powershell
docker logs payrail-mongodb
docker logs payrail-mongodb-setup
docker logs payrail-redis
docker logs payrail-rabbitmq
```

### 3. Stop Services
- Stop containers (preserving data volumes):
  ```powershell
  docker compose stop
  ```
- Down containers and remove private network:
  ```powershell
  docker compose down
  ```
- Down containers and remove persistent volumes:
  ```powershell
  docker compose down -v
  ```

---

## 🚀 Running the Application

### 1. Installation
```powershell
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```powershell
cp .env.example .env
```
Default ports and credentials configured:
- `PORT`: `3000` (API process)
- `MONGO_PORT`: `27018` (Mapped to container port `27017` to avoid clashing with local mongod)
- `REDIS_PORT`: `6379`
- `RABBITMQ_PORT`: `5672`
- `RABBITMQ_MGMT_PORT`: `15672`
- `JWT_SECRET`: `payrail_super_secret_jwt_key_dev_mode_32chars`
- `JWT_EXPIRES_IN`: `15m`

### 3. Start Development Server
```powershell
npm run dev
```

### 4. Code Quality & Build Checks
```powershell
npm run typecheck
npm run lint
npm run format
npm run build
```

---

## 🧪 Testing

### Unit, Integration, Auth & Transaction Tests (Jest + Supertest)
```powershell
npm test
```
All 25 tests across 4 suites validate:
1. `tests/auth.test.ts`: Registration, login, normalized emails, generic errors, tampered/expired tokens, and Redis logout revocation.
2. `tests/transactions.test.ts`: Multi-document ACID transaction commit/abort.
3. `tests/health.test.ts`: Liveness and deep readiness probes.
4. `tests/api.test.ts`: Route definitions and error handling.

---

## 📄 Documentation
Comprehensive architecture details and decision logs can be found in [docs/architecture.md](docs/architecture.md).
