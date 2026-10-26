import request from 'supertest';
import { app } from '../../examples/middleware-consumer/server';

describe('Local Middleware Consumer Integration Test', () => {
  it('rejects unauthenticated transfer requests', async () => {
    const res = await request(app)
      .post('/api/transfers')
      .send({ amount: 1000, destination: 'acc_123' });

    expect(res.status).toBe(401);
  });

  it('rejects transfer without idempotency key', async () => {
    const res = await request(app)
      .post('/api/transfers')
      .set('Authorization', 'Bearer demo-token-123')
      .send({ amount: 1000, destination: 'acc_123' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/is required/);
  });

  it('executes transfer and replays identically with the same key', async () => {
    const key = 'consumer-key-001';
    const first = await request(app)
      .post('/api/transfers')
      .set('Authorization', 'Bearer demo-token-123')
      .set('x-idempotency-key', key)
      .send({ amount: 1000, destination: 'acc_123' });

    expect(first.status).toBe(201);
    expect(first.body.data.transferId).toBe('tr_1');

    // Replay
    const replay = await request(app)
      .post('/api/transfers')
      .set('Authorization', 'Bearer demo-token-123')
      .set('x-idempotency-key', key)
      .send({ amount: 1000, destination: 'acc_123' });

    expect(replay.status).toBe(201);
    expect(replay.headers['x-cache-lookup']).toBe('IDEMPOTENT-REPLAY');
    expect(replay.body.data.transferId).toBe('tr_1'); // Same ID replayed
  });
});
