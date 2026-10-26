import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const MODE = __ENV.MODE || 'cached'; // 'cached' or 'baseline'

export const options = {
  vus: 5,
  duration: '10s',
  thresholds: {
    'http_req_duration': ['p(95)<300'],
    'http_req_failed': ['rate<0.01'],
  },
};

export function setup() {
  const users = [];
  for (let i = 0; i < 5; i++) {
    const uniqueId = `${Date.now()}_vu${i}_${Math.floor(Math.random() * 10000)}`;
    const email = `k6_user_${uniqueId}@example.com`;
    const password = 'K6Password123!';

    const regRes = http.post(
      `${BASE_URL}/api/v1/auth/register`,
      JSON.stringify({
        email,
        password,
        firstName: `VU${i}`,
        lastName: 'Tester',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );

    const token = regRes.json('data.token');

    const walletRes = http.post(
      `${BASE_URL}/api/v1/wallets`,
      JSON.stringify({ currency: 'INR' }),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const walletId = walletRes.json('data.id') || walletRes.json('data._id');

    // Pre-warm cache for cached mode
    if (MODE === 'cached') {
      http.get(`${BASE_URL}/api/v1/wallets/${walletId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    users.push({ token, walletId });
  }

  return { users };
}

export default function (data) {
  // Select user based on virtual user execution context
  const user = data.users[(__VU - 1) % data.users.length];
  let url = `${BASE_URL}/api/v1/wallets/${user.walletId}`;
  if (MODE === 'baseline') {
    url += `?_bust=${Date.now()}_${Math.random()}`;
  }

  const res = http.get(url, {
    headers: { Authorization: `Bearer ${user.token}` },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has valid payload': (r) => r.json('success') === true,
  });

  sleep(0.5); // 2 req/sec per user = 120 req/min (spread safely)
}
