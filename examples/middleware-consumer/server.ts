import express from 'express';
import {
  createAuthMiddleware,
  createIdempotencyMiddleware,
  createRateLimiterMiddleware,
  MemoryIdempotencyStorage,
  MemoryRateLimiterStorage,
} from '../../packages/payrail-middleware/src/index.js';

const app = express();
app.use(express.json());

// 1. Sliding-Window Rate Limiter
const rateLimiter = createRateLimiterMiddleware({
  storage: new MemoryRateLimiterStorage(),
  windowSeconds: 60,
  maxRequests: 20,
  keyPrefix: 'consumer-sample',
});
app.use(rateLimiter);

// 2. Authentication
const auth = createAuthMiddleware({
  verifyToken: async (token: string) => {
    if (token === 'demo-token-123') {
      return {
        userId: 'usr_demo_456',
        email: 'demo@payrail.com',
        role: 'user',
        tokenId: 'tok_demo',
      };
    }
    throw new Error('Invalid demo token');
  },
});

// 3. Idempotent Transfer Endpoint
const idempotency = createIdempotencyMiddleware({
  storage: new MemoryIdempotencyStorage(),
  headerName: 'x-idempotency-key',
  ttlSeconds: 86400,
});

let paymentCounter = 0;
app.post('/api/transfers', auth, idempotency, (req, res) => {
  paymentCounter++;
  res.status(201).json({
    success: true,
    message: 'Payment executed',
    data: {
      transferId: `tr_${paymentCounter}`,
      amount: req.body.amount,
      destination: req.body.destination,
    },
  });
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Middleware consumer example server listening on port ${PORT}`);
  });
}
