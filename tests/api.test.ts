import request from 'supertest';
import { createApp } from '../src/app';

describe('API v1 Routing and Module Scaffolds', () => {
  const app = createApp();

  describe('GET /api/v1', () => {
    it('should return list of registered active modules', async () => {
      const res = await request(app).get('/api/v1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        version: 'v1',
        status: 'active',
        modules: ['auth', 'wallets', 'transfers', 'ledger', 'cards', 'notifications'],
      });
      expect(res.headers['x-request-id']).toBeDefined();
    });
  });

  describe('Module route placeholders', () => {
    const modules = ['auth', 'wallets', 'transfers', 'ledger', 'cards', 'notifications'];

    modules.forEach((mod) => {
      it(`GET /api/v1/${mod} should return initialized status`, async () => {
        const res = await request(app).get(`/api/v1/${mod}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('module', mod);
        expect(res.body).toHaveProperty('status', 'initialized');
      });
    });
  });

  describe('Error handling & Not Found', () => {
    it('should return 404 with structured error response on unknown route', async () => {
      const res = await request(app).get('/api/v1/non-existent-route');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toHaveProperty('code', 'NotFoundError');
      expect(res.body.meta).toHaveProperty('requestId');
      expect(res.body.meta).toHaveProperty('timestamp');
    });
  });
});
