import request from 'supertest';
import express from 'express';
import { healthRouter } from '../../src/routes/health.routes';
import { database } from '../../src/config/database';

jest.mock('../../src/config/database');

describe('Health Routes Degraded Readiness (Unit)', () => {
  const app = express();
  app.use(healthRouter);

  it('GET /ready should return 503 when dependencies are down', async () => {
    (database.checkMongoStatus as jest.Mock).mockResolvedValue('down');
    (database.checkRedisStatus as jest.Mock).mockResolvedValue('up');
    (database.checkRabbitMQStatus as jest.Mock).mockResolvedValue('down');

    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.dependencies.mongodb.status).toBe('down');
  });
});
