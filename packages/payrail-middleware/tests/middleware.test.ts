import express from 'express';
import request from 'supertest';
import {
  createAuthMiddleware,
  createIdempotencyMiddleware,
  createRateLimiterMiddleware,
  MemoryIdempotencyStorage,
  MemoryRateLimiterStorage,
} from '../src/index.js';

describe('@payrail/middleware Reusable Package Tests', () => {
  describe('createAuthMiddleware', () => {
    const auth = createAuthMiddleware({
      verifyToken: async (token: string) => {
        if (token === 'valid-token') {
          return { userId: 'u123', email: 'user@payrail.com', tokenId: 'tok_abc' };
        }
        throw new Error('Signature verification failed');
      },
      isTokenRevoked: async (tokenId: string) => tokenId === 'tok_revoked',
    });

    const app = express();
    app.get('/protected', auth, (req, res) => {
      res.json({ success: true, user: (req as any).user });
    });

    it('rejects request with missing Authorization header', async () => {
      const res = await request(app).get('/protected');
      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/missing or malformed/);
    });

    it('rejects request with invalid token signature', async () => {
      const res = await request(app).get('/protected').set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Signature verification failed');
    });

    it('authenticates valid token and attaches user to request', async () => {
      const res = await request(app).get('/protected').set('Authorization', 'Bearer valid-token');
      expect(res.status).toBe(200);
      expect(res.body.user.userId).toBe('u123');
    });
  });

  describe('createIdempotencyMiddleware', () => {
    const storage = new MemoryIdempotencyStorage();
    const idempotency = createIdempotencyMiddleware({ storage });

    const app = express();
    app.use(express.json());
    let counter = 0;
    app.post('/charge', idempotency, (req, res) => {
      counter++;
      res.status(201).json({ chargeId: `ch_${counter}`, amount: req.body.amount });
    });

    it('rejects POST request when idempotency header is missing', async () => {
      const res = await request(app).post('/charge').send({ amount: 100 });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/is required/);
    });

    it('executes request and replays on repeated identical key without incrementing counter', async () => {
      const key = 'idem-key-test-1';
      const firstRes = await request(app)
        .post('/charge')
        .set('x-idempotency-key', key)
        .send({ amount: 500 });

      expect(firstRes.status).toBe(201);
      expect(firstRes.body.chargeId).toBe('ch_1');

      // Replay
      const secondRes = await request(app)
        .post('/charge')
        .set('x-idempotency-key', key)
        .send({ amount: 500 });

      expect(secondRes.status).toBe(201);
      expect(secondRes.headers['x-cache-lookup']).toBe('IDEMPOTENT-REPLAY');
      expect(secondRes.body.chargeId).toBe('ch_1'); // Counter was NOT incremented
      expect(counter).toBe(1);
    });

    it('returns 409 Conflict when same key is submitted with differing payload', async () => {
      const key = 'idem-key-conflict';
      await request(app)
        .post('/charge')
        .set('x-idempotency-key', key)
        .send({ amount: 100 });

      const conflictRes = await request(app)
        .post('/charge')
        .set('x-idempotency-key', key)
        .send({ amount: 999 });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error.code).toBe('Conflict');
    });
  });

  describe('createRateLimiterMiddleware', () => {
    const storage = new MemoryRateLimiterStorage();
    const limiter = createRateLimiterMiddleware({
      storage,
      windowSeconds: 60,
      maxRequests: 3,
      keyPrefix: 'test-lim',
    });

    const app = express();
    app.get('/limited', limiter, (_req, res) => {
      res.json({ ok: true });
    });

    it('allows requests within threshold and sets rate limit headers', async () => {
      const res1 = await request(app).get('/limited');
      expect(res1.status).toBe(200);
      expect(res1.headers['x-rateLimit-remaining'.toLowerCase()]).toBe('2');

      const res2 = await request(app).get('/limited');
      expect(res2.status).toBe(200);

      const res3 = await request(app).get('/limited');
      expect(res3.status).toBe(200);
    });

    it('returns 429 Too Many Requests with Retry-After when rate limit is exceeded', async () => {
      const res = await request(app).get('/limited');
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('TooManyRequests');
      expect(res.headers['retry-after']).toBeDefined();
    });
  });
});
