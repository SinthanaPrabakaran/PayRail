# @payrail/middleware

Production-grade, extensible middleware for Express applications built on TypeScript.

Provides:
- **Authentication Middleware (`createAuthMiddleware`)**: Bearer token verification, claims parsing, and Redis/storage token revocation checks.
- **Idempotency Middleware (`createIdempotencyMiddleware`)**: User-scoped idempotent execution with SHA-256 fingerprinting, replay caching, and 409 conflict detection.
- **Rate Limiting Middleware (`createRateLimiterMiddleware`)**: Distributed sliding-window rate limiting with per-IP and per-user identification, Retry-After headers, and resilient fail-open guarantees.

## Installation

```bash
npm install @payrail/middleware
```

## Quick Start Example

```typescript
import express from 'express';
import {
  createAuthMiddleware,
  createIdempotencyMiddleware,
  createRateLimiterMiddleware,
  MemoryIdempotencyStorage,
  MemoryRateLimiterStorage,
} from '@payrail/middleware';

const app = express();
app.use(express.json());

// 1. Rate Limiting
const rateLimiter = createRateLimiterMiddleware({
  storage: new MemoryRateLimiterStorage(),
  windowSeconds: 60,
  maxRequests: 30,
  keyPrefix: 'api',
});
app.use(rateLimiter);

// 2. Authentication
const authMiddleware = createAuthMiddleware({
  verifyToken: async (token) => {
    if (token === 'valid-secret-token') {
      return { userId: 'usr_123', email: 'alice@example.com' };
    }
    throw new Error('Invalid token');
  },
});

// 3. Idempotent Write Endpoint
const idempotencyMiddleware = createIdempotencyMiddleware({
  storage: new MemoryIdempotencyStorage(),
  headerName: 'x-idempotency-key',
  ttlSeconds: 86400,
});

app.post('/api/payments', authMiddleware, idempotencyMiddleware, (req, res) => {
  res.status(201).json({
    status: 'COMPLETED',
    paymentId: 'pay_999',
    amount: req.body.amount,
  });
});
```
