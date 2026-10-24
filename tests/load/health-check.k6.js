import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 20 },  // Ramp-up to 20 users
    { duration: '30s', target: 50 },  // Sustained load
    { duration: '10s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<150'], // 95% of requests must complete below 150ms
    http_req_failed: ['rate<0.01'],    // Error rate must be less than 1%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health returns ok status': (r) => JSON.parse(r.body).status === 'ok',
  });

  const apiRes = http.get(`${BASE_URL}/api/v1`);
  check(apiRes, {
    'api v1 status is 200': (r) => r.status === 200,
  });

  sleep(1);
}
