# PayRail 🚂💳

> Portfolio-grade simulated wallet and prepaid-card REST API engine built with Node.js LTS, TypeScript strict mode, Express.js, MongoDB, Redis, RabbitMQ, Jest, Supertest, and k6.

---

## 📌 Phase 2 Status
Phase 2 establishes robust infrastructure lifecycles:
- **MongoDB 7.0 Single-Node Replica Set (`rs0`)**: Full support for ACID multi-document transactions.
- **Redis 7.2 (Authenticated & AOF Persistent)**: Secure cache & distributed locks.
- **RabbitMQ 3.13 (Management UI enabled)**: AMQP messaging broker with separate credentials.
- **Lifecycle-Managed Modules**: Dedicated connection managers ([src/config/mongo.ts](src/config/mongo.ts), [src/config/redis.ts](src/config/redis.ts), [src/config/rabbitmq.ts](src/config/rabbitmq.ts)) featuring bounded retries and clean disposal.
- **Safe Startup & Graceful Shutdown**: Ordered connection bootstrap and clean SIGTERM/SIGINT teardown.
- **Deep Health & Readiness Probes**: Evaluates connection states and live MongoDB transaction capabilities at `/ready`.

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
Default ports configured:
- `PORT`: `3000` (API process)
- `MONGO_PORT`: `27018` (Mapped to container port `27017` to avoid clashing with local mongod)
- `REDIS_PORT`: `6379`
- `RABBITMQ_PORT`: `5672`
- `RABBITMQ_MGMT_PORT`: `15672`

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

### Unit, Integration & ACID Transaction Tests (Jest + Supertest)
```powershell
npm test
```
All 12 tests across 3 suites validate `/health`, `/ready`, `/api/v1`, and MongoDB multi-document ACID transactions with session commit/rollback.

---

## 📡 API Endpoints (Phase 2)
| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/health` | `GET` | Liveness probe returning process uptime & requestId |
| `/ready` | `GET` | Readiness probe checking MongoDB (with transaction support), Redis (auth), & RabbitMQ |
| `/api/v1` | `GET` | Core API v1 descriptor & registered modules |
| `/api/v1/auth` | `GET` | Auth module base endpoint (scaffold) |
| `/api/v1/wallets` | `GET` | Wallets module base endpoint (scaffold) |
| `/api/v1/transfers` | `GET` | Transfers module base endpoint (scaffold) |
| `/api/v1/ledger` | `GET` | Ledger module base endpoint (scaffold) |
| `/api/v1/cards` | `GET` | Cards module base endpoint (scaffold) |
| `/api/v1/notifications` | `GET` | Notifications module base endpoint (scaffold) |

---

## 📄 Documentation
Comprehensive architecture details and decision logs can be found in [docs/architecture.md](docs/architecture.md).
