# PayRail 🚂💳

> Portfolio-grade simulated wallet and prepaid-card REST API engine built with Node.js LTS, TypeScript strict mode, Express.js, MongoDB, Redis, RabbitMQ, Jest, Supertest, and k6.

---

## 📌 Phase 1 Status
Phase 1 establishes the production-grade architectural foundation, modular scaffolding, cross-cutting concerns, environment schema validation, health/readiness probes, and CI/CD validation baselines.

No fake business logic is implemented. Domain modules are cleanly isolated in `src/modules/` with interface boundaries prepared for Phase 2+.

---

## 🏗️ Architecture & Features Overview
- **Feature-Oriented Structure**: Scalable modular code organization under `src/modules/` (`auth`, `wallets`, `transfers`, `ledger`, `cards`, `notifications`).
- **Strict TypeScript**: Configured with `strict: true`, `noImplicitAny`, and `exactOptionalPropertyTypes` style constraints.
- **Fail-Fast Environment Validation**: Zod-based configuration schema with explicit typing (`src/config/env.ts`).
- **Resilient Health Probes**:
  - `GET /health` (Liveness): Validates HTTP event-loop responsiveness.
  - `GET /ready` (Readiness): Deep-checks connectivity to MongoDB, Redis, and RabbitMQ with status reporting.
- **Correlation & Tracing**: Automatic `x-request-id` propagation through middleware, response headers, and structured Winston logging.
- **Robust Error Handling**: Domain `AppError` class hierarchy and centralized middleware generating uniform API responses.
- **Background Jobs**: RabbitMQ queue management (`src/queues/`) and worker lifecycle abstraction (`src/workers/`).
- **Load Testing**: Pre-configured k6 script for performance benchmarking (`tests/load/health-check.k6.js`).
- **Container Parity**: Local multi-container infrastructure via `docker-compose.yml` and multi-stage production `Dockerfile`.

---

## 🚀 Getting Started

### Prerequisites
- Node.js LTS (v20+ or v22+)
- Docker & Docker Compose (optional for local DBs/queues)

### 1. Installation
Clone the repository and install dependencies:
```bash
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Key variables:
- `PORT`: HTTP port (defaults to `3000`)
- `NODE_ENV`: `development`, `production`, or `test`
- `MONGODB_URI`: MongoDB connection string
- `REDIS_HOST` / `REDIS_PORT`: Redis cache/locks
- `RABBITMQ_URL`: AMQP connection URI

### 3. Spin Up Local Infrastructure (Optional)
Start MongoDB, Redis, and RabbitMQ via Docker Compose:
```bash
docker compose up -d
```

### 4. Running the Application
- **Development mode** (hot-reload via `tsx`):
  ```bash
  npm run dev
  ```
- **Type checking**:
  ```bash
  npm run typecheck
  ```
- **Linting & Code Formatting**:
  ```bash
  npm run lint
  npm run format
  ```
- **Production Build**:
  ```bash
  npm run build
  npm start
  ```

---

## 🧪 Testing

### Unit & Integration Tests (Jest + Supertest)
```bash
npm test
```
To run tests with coverage reporting:
```bash
npm run test:coverage
```

### Performance & Load Testing (k6)
With the application running locally:
```bash
k6 run tests/load/health-check.k6.js
```

---

## 📡 API Endpoints (Phase 1)
| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/health` | `GET` | Liveness probe returning process uptime & requestId |
| `/ready` | `GET` | Readiness probe checking MongoDB, Redis, & RabbitMQ status |
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
