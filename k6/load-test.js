import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Configurable target URL: Default to local development instance
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    // 1. Health & Readiness checks
    health_checks: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '3s', target: 3 },
        { duration: '8s', target: 3 },
        { duration: '3s', target: 0 },
      ],
      exec: 'healthScenario',
      tags: { scenario: 'health' },
    },
    // 2. Cached read endpoints (e.g. Wallet summary)
    cached_reads: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '3s', target: 4 },
        { duration: '8s', target: 4 },
        { duration: '3s', target: 0 },
      ],
      exec: 'cachedReadsScenario',
      tags: { scenario: 'cached_reads' },
      startTime: '3s',
    },
    // 3. Uncached/Paginated wallet ledger queries
    wallet_reads: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '3s', target: 4 },
        { duration: '8s', target: 4 },
        { duration: '3s', target: 0 },
      ],
      exec: 'walletReadsScenario',
      tags: { scenario: 'wallet_reads' },
      startTime: '3s',
    },
    // 4. Successful transfers with unique idempotency keys
    unique_transfers: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '3s', target: 3 },
        { duration: '8s', target: 3 },
        { duration: '3s', target: 0 },
      ],
      exec: 'transfersScenario',
      tags: { scenario: 'unique_transfers' },
      startTime: '5s',
    },
    // 5. Repeated idempotent requests (verifying HTTP 200 replay with identical payload)
    repeated_idempotent: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '3s', target: 3 },
        { duration: '8s', target: 3 },
        { duration: '3s', target: 0 },
      ],
      exec: 'repeatedIdempotentScenario',
      tags: { scenario: 'repeated_idempotent' },
      startTime: '5s',
    },
    // 6. Mixed realistic traffic
    mixed_traffic: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '3s', target: 5 },
        { duration: '10s', target: 5 },
        { duration: '3s', target: 0 },
      ],
      exec: 'mixedTrafficScenario',
      tags: { scenario: 'mixed_traffic' },
      startTime: '7s',
    },
  },
  thresholds: {
    // Realistic thresholds based on local Docker MongoDB replica-set & Redis
    'http_req_duration': ['p(95)<500'], // p95 response time under 500ms
    'http_req_duration{scenario:cached_reads}': ['p(95)<150'], // Redis cached reads p95 under 150ms
    'http_req_failed': ['rate<0.05'], // Overall error rate under 5%
    'checks': ['rate>0.95'], // Checks pass rate > 95%
  },
};

// ----------------------------------------------------------------------------------
// SETUP PHASE: Create test accounts and seed sufficient balances
// ----------------------------------------------------------------------------------
export function setup() {
  const users = [];
  const count = 10;
  const timestamp = Date.now().toString().slice(-6);

  for (let i = 0; i < count; i++) {
    const senderEmail = `k6_s_${timestamp}_${i}@example.com`;
    const receiverEmail = `k6_r_${timestamp}_${i}@example.com`;
    const password = 'K6Password123!';

    // Register sender
    const regSenderRes = http.post(
      `${BASE_URL}/api/v1/auth/register`,
      JSON.stringify({
        email: senderEmail,
        password: password,
        firstName: `Sender${i}`,
        lastName: 'K6Test',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    const senderToken = regSenderRes.json('data.token');

    // Register receiver
    const regReceiverRes = http.post(
      `${BASE_URL}/api/v1/auth/register`,
      JSON.stringify({
        email: receiverEmail,
        password: password,
        firstName: `Receiver${i}`,
        lastName: 'K6Test',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    const receiverToken = regReceiverRes.json('data.token');

    // Create wallet for sender
    const senderWalletRes = http.post(
      `${BASE_URL}/api/v1/wallets`,
      JSON.stringify({ currency: 'INR' }),
      {
        headers: {
          Authorization: `Bearer ${senderToken}`,
          'Content-Type': 'application/json',
        },
      },
    );
    const senderWalletId = senderWalletRes.json('data.id') || senderWalletRes.json('data._id');

    // Create wallet for receiver
    const receiverWalletRes = http.post(
      `${BASE_URL}/api/v1/wallets`,
      JSON.stringify({ currency: 'INR' }),
      {
        headers: {
          Authorization: `Bearer ${receiverToken}`,
          'Content-Type': 'application/json',
        },
      },
    );
    const receiverWalletId = receiverWalletRes.json('data.id') || receiverWalletRes.json('data._id');

    // Seed sender balance with 10,000,000 minor units (INR 100,000)
    http.post(
      `${BASE_URL}/api/v1/wallets/${senderWalletId}/deposit`,
      JSON.stringify({ amount: 10000000, reference: 'K6_LOAD_TEST_SEED' }),
      {
        headers: {
          Authorization: `Bearer ${senderToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    // Seed an initial transfer for idempotency replay scenario
    const seedKey = `k6-seed-idemp-${timestamp}-${i}`;
    http.post(
      `${BASE_URL}/api/v1/transfers`,
      JSON.stringify({
        sourceWalletId: senderWalletId,
        destinationWalletId: receiverWalletId,
        amount: 100,
        description: 'Seed transfer for idempotency replay test',
      }),
      {
        headers: {
          Authorization: `Bearer ${senderToken}`,
          'Content-Type': 'application/json',
          'x-idempotency-key': seedKey,
        },
      },
    );

    users.push({
      senderToken,
      receiverToken,
      senderWalletId,
      receiverWalletId,
      replayedIdempotencyKey: seedKey,
    });
  }

  return { users };
}

// ----------------------------------------------------------------------------------
// SCENARIO 1: Health & Deep Readiness
// ----------------------------------------------------------------------------------
export function healthScenario() {
  group('Health Check Endpoints', () => {
    const res = http.get(`${BASE_URL}/health`);
    check(res, {
      'health status is 200': (r) => r.status === 200,
      'has requestId in headers': (r) => r.headers['X-Request-Id'] !== undefined,
    });
  });
  sleep(0.5);
}

// ----------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------
// SCENARIO 2: Cached Read Endpoints (Wallet summary with Redis Hit/Miss)
// ----------------------------------------------------------------------------------
export function cachedReadsScenario(data) {
  const user = data.users[(__VU - 1) % data.users.length];
  group('Cached Reads (Wallet Summary)', () => {
    const res = http.get(`${BASE_URL}/api/v1/wallets/${user.senderWalletId}`, {
      headers: { Authorization: `Bearer ${user.senderToken}` },
    });
    check(res, {
      'wallet read status is 200': (r) => r.status === 200,
      'response has valid X-Cache header': (r) =>
        r.headers['X-Cache'] === 'HIT' || r.headers['X-Cache'] === 'MISS',
    });
  });
  sleep(0.5);
}

// ----------------------------------------------------------------------------------
// SCENARIO 3: Uncached / Paginated Ledger Reads
// ----------------------------------------------------------------------------------
export function walletReadsScenario(data) {
  const user = data.users[(__VU - 1) % data.users.length];
  group('Uncached Realtime Reconciliation', () => {
    const res = http.get(
      `${BASE_URL}/api/v1/wallets/${user.senderWalletId}/reconcile`,
      {
        headers: { Authorization: `Bearer ${user.senderToken}` },
      },
    );
    check(res, {
      'reconcile status is 200': (r) => r.status === 200,
      'reconciliation is balanced': (r) => r.json('data.isReconciled') === true,
    });
  });
  sleep(0.5);
}

// ----------------------------------------------------------------------------------
// SCENARIO 4: Successful Transfers with Unique Idempotency Keys
// ----------------------------------------------------------------------------------
export function transfersScenario(data) {
  const user = data.users[(__VU - 1) % data.users.length];
  group('Unique Transfers', () => {
    const key = `k6-tx-${uuidv4()}`;
    const payload = JSON.stringify({
      sourceWalletId: user.senderWalletId,
      destinationWalletId: user.receiverWalletId,
      amount: 10, // Minor units
      description: 'K6 unique idempotent transfer',
    });

    const res = http.post(`${BASE_URL}/api/v1/transfers`, payload, {
      headers: {
        Authorization: `Bearer ${user.senderToken}`,
        'Content-Type': 'application/json',
        'x-idempotency-key': key,
      },
    });

    check(res, {
      'transfer status is 201': (r) => r.status === 201,
      'transfer marked EXECUTED': (r) => r.json('meta.idempotencyStatus') === 'EXECUTED',
    });
  });
  sleep(1.0);
}

// ----------------------------------------------------------------------------------
// SCENARIO 5: Repeated Idempotent Requests (Replay Verification)
// ----------------------------------------------------------------------------------
export function repeatedIdempotentScenario(data) {
  const user = data.users[(__VU - 1) % data.users.length];
  group('Repeated Idempotent Requests', () => {
    const payload = JSON.stringify({
      sourceWalletId: user.senderWalletId,
      destinationWalletId: user.receiverWalletId,
      amount: 100,
      description: 'Seed transfer for idempotency replay test',
    });

    const res = http.post(`${BASE_URL}/api/v1/transfers`, payload, {
      headers: {
        Authorization: `Bearer ${user.senderToken}`,
        'Content-Type': 'application/json',
        'x-idempotency-key': user.replayedIdempotencyKey,
      },
    });

    check(res, {
      'repeated request status is 200': (r) => r.status === 200,
      'idempotency status is REPLAYED': (r) => r.json('meta.idempotencyStatus') === 'REPLAYED',
    });
  });
  sleep(0.5);
}

// ----------------------------------------------------------------------------------
// SCENARIO 6: Mixed Realistic Traffic
// ----------------------------------------------------------------------------------
export function mixedTrafficScenario(data) {
  const user = data.users[(__VU - 1) % data.users.length];
  const rand = Math.random();
  if (rand < 0.4) {
    // 40% cached reads
    http.get(`${BASE_URL}/api/v1/wallets/${user.senderWalletId}`, {
      headers: { Authorization: `Bearer ${user.senderToken}` },
    });
  } else if (rand < 0.7) {
    // 30% transaction history reads
    http.get(`${BASE_URL}/api/v1/wallets/${user.senderWalletId}/transactions?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${user.senderToken}` },
    });
  } else if (rand < 0.9) {
    // 20% repeated idempotent requests
    http.post(
      `${BASE_URL}/api/v1/transfers`,
      JSON.stringify({
        sourceWalletId: user.senderWalletId,
        destinationWalletId: user.receiverWalletId,
        amount: 100,
        description: 'Seed transfer for idempotency replay test',
      }),
      {
        headers: {
          Authorization: `Bearer ${user.senderToken}`,
          'Content-Type': 'application/json',
          'x-idempotency-key': user.replayedIdempotencyKey,
        },
      },
    );
  } else {
    // 10% new transfers
    http.post(
      `${BASE_URL}/api/v1/transfers`,
      JSON.stringify({
        sourceWalletId: user.senderWalletId,
        destinationWalletId: user.receiverWalletId,
        amount: 15,
        description: 'Mixed traffic transfer',
      }),
      {
        headers: {
          Authorization: `Bearer ${user.senderToken}`,
          'Content-Type': 'application/json',
          'x-idempotency-key': `k6-mixed-${uuidv4()}`,
        },
      },
    );
  }
  sleep(0.5);
}

// ----------------------------------------------------------------------------------
// TEARDOWN PHASE: Summary report generation
// ----------------------------------------------------------------------------------
export function teardown(data) {
  const user = data.users[0];
  const res = http.get(`${BASE_URL}/api/v1/wallets/${user.senderWalletId}`, {
    headers: { Authorization: `Bearer ${user.senderToken}` },
  });
  if (res.status === 200) {
    console.log(`[k6 Teardown] Sample test sender wallet balance: ${res.json('data.balance')} minor units`);
  }
}
