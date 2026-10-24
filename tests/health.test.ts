import request from 'supertest';
import { createApp } from '../src/app';

describe('Health and Readiness Endpoints', () => {
  const app = createApp();

  describe('GET /health', () => {
    it('should return 200 OK with liveness details and requestId header', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('should echo client supplied x-request-id header', async () => {
      const customId = 'test-trace-id-12345';
      const res = await request(app).get('/health').set('x-request-id', customId);

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(customId);
      expect(res.body.meta.requestId).toBe(customId);
    });
  });

  describe('GET /ready', () => {
    it('should return status report for dependencies (returns 503 if disconnected in test mode)', async () => {
      const res = await request(app).get('/ready');

      // In local unit test without active DBs, ready should return 503 degraded
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('dependencies');
      expect(res.body.dependencies).toHaveProperty('mongodb');
      expect(res.body.dependencies).toHaveProperty('redis');
      expect(res.body.dependencies).toHaveProperty('rabbitmq');
    });
  });
});
