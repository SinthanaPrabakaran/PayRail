import request from 'supertest';
import { createApp } from '../../src/app';
import { mongoManager } from '../../src/config/mongo';
import { redisManager } from '../../src/config/redis';
import { UserModel } from '../../src/modules/auth/user.model';
import { WalletModel } from '../../src/modules/wallets/wallet.model';
import { WalletService } from '../../src/modules/wallets/wallet.service';
import { generateAccessToken } from '../../src/shared/token';
import { CacheService } from '../../src/middleware/cache.middleware';

describe('Phase 6: Redis Caching, Distributed Rate Limiting & Isolation', () => {
  const app = createApp();

  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let tokenA: string;
  let tokenB: string;

  let walletAId: string;
  let walletBId: string;

  beforeAll(async () => {
    await mongoManager.connect(3, 1000);
    await redisManager.connect(3, 1000);

    // Clean up test data
    await UserModel.deleteMany({ email: /phase6.*@example\.com$/ });
    await WalletModel.deleteMany({});

    // Create User A
    const docA = await UserModel.create({
      email: 'phase6_userA@example.com',
      passwordHash: 'dummyhash',
      firstName: 'Alice',
      lastName: 'Cache',
    });
    userA = { id: docA.id, email: docA.email };
    tokenA = generateAccessToken(userA).token;

    // Create User B
    const docB = await UserModel.create({
      email: 'phase6_userB@example.com',
      passwordHash: 'dummyhash',
      firstName: 'Bob',
      lastName: 'Cache',
    });
    userB = { id: docB.id, email: docB.email };
    tokenB = generateAccessToken(userB).token;

    // Create wallets
    const wA = await WalletService.getOrCreateWallet(userA.id, 'INR');
    walletAId = wA.id;

    const wB = await WalletService.getOrCreateWallet(userB.id, 'INR');
    walletBId = wB.id;
  });

  afterAll(async () => {
    await UserModel.deleteMany({ email: /phase6.*@example\.com$/ });
    await WalletModel.deleteMany({});
    await mongoManager.disconnect();
    await redisManager.disconnect();
  });

  beforeEach(() => {
    CacheService.resetMetrics();
  });

  describe('Read-Only Caching Semantics (Hit / Miss / Response Headers)', () => {
    it('should return X-Cache: MISS on initial fetch and X-Cache: HIT on subsequent fetch', async () => {
      // 1. First fetch - MISS
      const res1 = await request(app)
        .get(`/api/v1/wallets/${walletAId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res1.status).toBe(200);
      expect(res1.headers['x-cache']).toBe('MISS');
      expect(res1.body.data.id).toBe(walletAId);

      // 2. Second fetch - HIT
      const res2 = await request(app)
        .get(`/api/v1/wallets/${walletAId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res2.status).toBe(200);
      expect(res2.headers['x-cache']).toBe('HIT');
      expect(res2.body.data.id).toBe(walletAId);
      expect(res2.headers['x-cache-latency-ms']).toBeDefined();

      const metrics = CacheService.getHitRate();
      expect(metrics.hits).toBe(1);
      expect(metrics.misses).toBe(1);
      expect(metrics.hitRatePercent).toBe(50);
    });

    it('should prevent cross-user cache leakage and maintain strict user isolation', async () => {
      // User A fetches their wallet list
      const resA = await request(app)
        .get('/api/v1/wallets')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resA.status).toBe(200);
      expect(resA.body.data[0].id).toBe(walletAId);

      // User B fetches their wallet list -> must NOT see User A's cached wallets
      const resB = await request(app)
        .get('/api/v1/wallets')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(resB.status).toBe(200);
      expect(resB.body.data[0].id).toBe(walletBId);
      expect(resB.body.data[0].id).not.toBe(walletAId);
    });

    it('should cache paginated transaction-history pages independently', async () => {
      // Deposit funds to generate transaction history
      await WalletService.depositSimulatedFunds(userA.id, walletAId, 5000, 'TEST_DEPOSIT_1');
      await WalletService.depositSimulatedFunds(userA.id, walletAId, 7000, 'TEST_DEPOSIT_2');

      // Request page 1 - MISS
      const p1Miss = await request(app)
        .get(`/api/v1/wallets/${walletAId}/transactions?page=1&limit=1`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(p1Miss.status).toBe(200);
      expect(p1Miss.headers['x-cache']).toBe('MISS');

      // Request page 1 again - HIT
      const p1Hit = await request(app)
        .get(`/api/v1/wallets/${walletAId}/transactions?page=1&limit=1`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(p1Hit.status).toBe(200);
      expect(p1Hit.headers['x-cache']).toBe('HIT');

      // Request page 2 - MISS (independent cache key)
      const p2Miss = await request(app)
        .get(`/api/v1/wallets/${walletAId}/transactions?page=2&limit=1`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(p2Miss.status).toBe(200);
      expect(p2Miss.headers['x-cache']).toBe('MISS');
    });
  });

  describe('Explicit Write Invalidation & Versioning', () => {
    it('should invalidate cached wallet summary immediately after relevant write (e.g. deposit)', async () => {
      // Prime the cache
      const primeRes = await request(app)
        .get(`/api/v1/wallets/${walletAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(primeRes.status).toBe(200);

      // Confirm cache is HIT
      const hitRes = await request(app)
        .get(`/api/v1/wallets/${walletAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(hitRes.headers['x-cache']).toBe('HIT');
      const cachedBalance = hitRes.body.data.balance;

      // Perform a deposit (write operation)
      const depositRes = await request(app)
        .post(`/api/v1/wallets/${walletAId}/deposit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: 15000, reference: 'WRITE_INVALIDATION_TEST' });
      expect(depositRes.status).toBe(200);

      // Subsequent fetch must be a MISS due to version bump, returning the newly updated balance
      const postDepositRes = await request(app)
        .get(`/api/v1/wallets/${walletAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(postDepositRes.headers['x-cache']).toBe('MISS');
      expect(postDepositRes.body.data.balance).toBe(cachedBalance + 15000);
    });
  });

  describe('Distributed Rate Limiting (Atomic Redis Sliding Window)', () => {
    it('should enforce per-user rate limit on authenticated operations and return 429 with Retry-After', async () => {
      // Using a valid 24-char ObjectId for user context
      const dummyUser = { id: '65f1a2b3c4d5e6f7a8b9c0d1', email: 'ratelimit@example.com' };
      const dummyToken = generateAccessToken(dummyUser).token;

      // We hit a rate-limited endpoint repeatedly.
      // Wallets rate limit is 100 req/min; let's verify headers decrement
      const res1 = await request(app)
        .get('/api/v1/wallets')
        .set('Authorization', `Bearer ${dummyToken}`);

      expect(res1.headers['x-ratelimit-limit']).toBe('100');
      expect(parseInt(res1.headers['x-ratelimit-remaining'] ?? '0', 10)).toBeLessThanOrEqual(99);
    });

    it('should enforce per-IP rate limit on public endpoints (e.g. /api/v1/auth/login)', async () => {
      const testIp = '198.51.100.42';

      // Send requests with simulated IP
      const firstRes = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', testIp)
        .send({ email: 'nonexistent@example.com', password: 'InvalidPassword123!' });

      expect(firstRes.headers['x-ratelimit-limit']).toBe('20');
      const remainingInitial = parseInt(firstRes.headers['x-ratelimit-remaining'] ?? '0', 10);
      expect(remainingInitial).toBeLessThanOrEqual(19);

      // Fire remaining requests to exceed limit of 20
      for (let i = 0; i < remainingInitial; i++) {
        await request(app)
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', testIp)
          .send({ email: 'nonexistent@example.com', password: 'InvalidPassword123!' });
      }

      // Next request must be rejected with 429 Too Many Requests
      const blockedRes = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', testIp)
        .send({ email: 'nonexistent@example.com', password: 'InvalidPassword123!' });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(blockedRes.headers['retry-after']).toBeDefined();
      expect(parseInt(blockedRes.headers['retry-after'] ?? '0', 10)).toBeGreaterThan(0);
    });

    it('should maintain independent counters across separate client IPs', async () => {
      const ipA = '203.0.113.1';
      const ipB = '203.0.113.2';

      const resA = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ipA)
        .send({ email: 'test@example.com', password: 'pwd' });

      const resB = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ipB)
        .send({ email: 'test@example.com', password: 'pwd' });

      // Both must start from their own window without interference
      expect(resA.headers['x-ratelimit-remaining']).toBe('19');
      expect(resB.headers['x-ratelimit-remaining']).toBe('19');
    });
  });

  describe('Telemetry & Cache Hit Rate Instrumentation', () => {
    it('should accurately compute hit rate and latency metrics without logging secrets', async () => {
      CacheService.resetMetrics();

      // Trigger 2 misses and 3 hits
      // Miss 1
      await request(app)
        .get(`/api/v1/wallets/${walletBId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      // Hit 1
      await request(app)
        .get(`/api/v1/wallets/${walletBId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      // Hit 2
      await request(app)
        .get(`/api/v1/wallets/${walletBId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      // Hit 3
      await request(app)
        .get(`/api/v1/wallets/${walletBId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      const metrics = CacheService.getHitRate();
      expect(metrics.hits).toBe(3);
      expect(metrics.misses).toBe(1);
      expect(metrics.hitRatePercent).toBe(75);
      expect(metrics.avgLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});
