import request from 'supertest';
import { createApp } from '../src/app.js';
import { mongoManager } from '../src/config/mongo.js';
import { redisManager } from '../src/config/redis.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { WalletModel } from '../src/modules/wallets/wallet.model.js';
import { WalletService } from '../src/modules/wallets/wallet.service.js';
import { generateAccessToken } from '../src/shared/token.js';
import { CacheService } from '../src/middleware/cache.middleware.js';

interface BenchmarkStat {
  minMs: number;
  maxMs: number;
  avgMs: number;
  p95Ms: number;
  totalRuns: number;
}

function calculateStats(samples: number[]): BenchmarkStat {
  const sorted = [...samples].sort((a, b) => a - b);
  const minMs = sorted[0] ?? 0;
  const maxMs = sorted[sorted.length - 1] ?? 0;
  const sum = sorted.reduce((acc, curr) => acc + curr, 0);
  const avgMs = parseFloat((sum / sorted.length).toFixed(2));
  const p95Idx = Math.floor(sorted.length * 0.95);
  const p95Ms = sorted[p95Idx] ?? maxMs;

  return { minMs, maxMs, avgMs, p95Ms, totalRuns: samples.length };
}

async function runBenchmark() {
  console.log('===============================================================');
  console.log('⚡ PayRail Phase 6 Benchmark: Cache MISS (Uncached/DB) vs Cache HIT (Redis)');
  console.log('===============================================================\n');

  await mongoManager.connect(3, 1000);
  await redisManager.connect(3, 1000);

  const app = createApp();

  // Create isolated benchmark user
  const benchmarkUser = await UserModel.create({
    email: `benchmark_${Date.now()}@example.com`,
    passwordHash: 'dummyhash',
    firstName: 'Bench',
    lastName: 'Mark',
  });
  const token = generateAccessToken({ id: benchmarkUser.id, email: benchmarkUser.email }).token;

  // Create wallet and seed ledger transactions
  const wallet = await WalletService.getOrCreateWallet(benchmarkUser.id, 'INR');
  for (let i = 1; i <= 15; i++) {
    await WalletService.depositSimulatedFunds(benchmarkUser.id, wallet.id, 1000 * i, `SEED_TX_${i}`);
  }

  const ITERATIONS = 30;

  // -------------------------------------------------------------------------
  // 1. Benchmark: Wallet Summary Read (/api/v1/wallets/:id)
  // -------------------------------------------------------------------------
  console.log(`Running ${ITERATIONS} iterations for GET /api/v1/wallets/:id ...`);

  // Clear rate limit key for benchmark user before each run
  await redisManager.getClient().del(`payrail:ratelimit:wallets_api:usr:${benchmarkUser.id}`);

  // (a) Cold / Uncached Read Samples (Force Cache Invalidation Before Each Call)
  const summaryColdSamples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    await CacheService.bumpUserVersion(benchmarkUser.id, 'wallets');
    const start = process.hrtime.bigint();
    const res = await request(app)
      .get(`/api/v1/wallets/${wallet.id}`)
      .set('Authorization', `Bearer ${token}`);
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    if (res.status === 200) {
      summaryColdSamples.push(durationMs);
    }
  }

  // Clear rate limiter again
  await redisManager.getClient().del(`payrail:ratelimit:wallets_api:usr:${benchmarkUser.id}`);

  // (b) Warm / Cached Read Samples (Prime cache once, then fire cached hits)
  const summaryWarmSamples: number[] = [];
  // Prime cache
  await request(app)
    .get(`/api/v1/wallets/${wallet.id}`)
    .set('Authorization', `Bearer ${token}`);

  for (let i = 0; i < ITERATIONS; i++) {
    const start = process.hrtime.bigint();
    const res = await request(app)
      .get(`/api/v1/wallets/${wallet.id}`)
      .set('Authorization', `Bearer ${token}`);
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    if (res.status === 200 && res.headers['x-cache'] === 'HIT') {
      summaryWarmSamples.push(durationMs);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Benchmark: Paginated Transaction History (/api/v1/wallets/:id/transactions)
  // -------------------------------------------------------------------------
  console.log(`Running ${ITERATIONS} iterations for GET /api/v1/wallets/:id/transactions ...`);

  // Clear rate limiter
  await redisManager.getClient().del(`payrail:ratelimit:wallets_api:usr:${benchmarkUser.id}`);

  // (a) Cold / Uncached Read Samples
  const historyColdSamples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    await CacheService.bumpUserVersion(benchmarkUser.id, 'wallets');
    const start = process.hrtime.bigint();
    const res = await request(app)
      .get(`/api/v1/wallets/${wallet.id}/transactions?page=1&limit=10`)
      .set('Authorization', `Bearer ${token}`);
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    if (res.status === 200) {
      historyColdSamples.push(durationMs);
    }
  }

  // Clear rate limiter
  await redisManager.getClient().del(`payrail:ratelimit:wallets_api:usr:${benchmarkUser.id}`);

  // (b) Warm / Cached Read Samples
  const historyWarmSamples: number[] = [];
  await request(app)
    .get(`/api/v1/wallets/${wallet.id}/transactions?page=1&limit=10`)
    .set('Authorization', `Bearer ${token}`);

  for (let i = 0; i < ITERATIONS; i++) {
    const start = process.hrtime.bigint();
    const res = await request(app)
      .get(`/api/v1/wallets/${wallet.id}/transactions?page=1&limit=10`)
      .set('Authorization', `Bearer ${token}`);
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    if (res.status === 200 && res.headers['x-cache'] === 'HIT') {
      historyWarmSamples.push(durationMs);
    }
  }

  // Teardown
  await UserModel.findByIdAndDelete(benchmarkUser.id);
  await WalletModel.findByIdAndDelete(wallet.id);
  await mongoManager.disconnect();
  await redisManager.disconnect();

  const summaryColdStats = calculateStats(summaryColdSamples);
  const summaryWarmStats = calculateStats(summaryWarmSamples);
  const historyColdStats = calculateStats(historyColdSamples);
  const historyWarmStats = calculateStats(historyWarmSamples);

  console.log('\n📊 BENCHMARK RESULTS (Measured under identical test harness):');
  console.log('---------------------------------------------------------------');
  console.log('1. Endpoint: GET /api/v1/wallets/:id (Wallet Summary)');
  console.log(`   - Uncached (MongoDB Cold): avg=${summaryColdStats.avgMs}ms, p95=${summaryColdStats.p95Ms.toFixed(2)}ms, min=${summaryColdStats.minMs.toFixed(2)}ms, max=${summaryColdStats.maxMs.toFixed(2)}ms (${summaryColdStats.totalRuns} runs)`);
  console.log(`   - Cached (Redis Warm):     avg=${summaryWarmStats.avgMs}ms, p95=${summaryWarmStats.p95Ms.toFixed(2)}ms, min=${summaryWarmStats.minMs.toFixed(2)}ms, max=${summaryWarmStats.maxMs.toFixed(2)}ms (${summaryWarmStats.totalRuns} runs)`);
  console.log('---------------------------------------------------------------');
  console.log('2. Endpoint: GET /api/v1/wallets/:id/transactions (Paginated Ledger)');
  console.log(`   - Uncached (MongoDB Cold): avg=${historyColdStats.avgMs}ms, p95=${historyColdStats.p95Ms.toFixed(2)}ms, min=${historyColdStats.minMs.toFixed(2)}ms, max=${historyColdStats.maxMs.toFixed(2)}ms (${historyColdStats.totalRuns} runs)`);
  console.log(`   - Cached (Redis Warm):     avg=${historyWarmStats.avgMs}ms, p95=${historyWarmStats.p95Ms.toFixed(2)}ms, min=${historyWarmStats.minMs.toFixed(2)}ms, max=${historyWarmStats.maxMs.toFixed(2)}ms (${historyWarmStats.totalRuns} runs)`);
  console.log('===============================================================\n');
}

runBenchmark().catch((err) => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});
