import request from 'supertest';
import express from 'express';
import { transfersRouter } from '../../src/modules/transfers/transfers.routes';
import { TransferService } from '../../src/modules/transfers/transfer.service';
import { errorHandler } from '../../src/middleware/errorHandler.middleware';
import mongoose from 'mongoose';

jest.mock('../../src/modules/transfers/transfer.service');
jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: '507f1f77bcf86cd799439011', email: 'user@example.com', role: 'user' };
    next();
  },
}));
jest.mock('../../src/middleware/rateLimiter.middleware', () => ({
  rateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

describe('Transfers Controller & Routes (Unit)', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/transfers', transfersRouter);
  app.use(errorHandler);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/transfers', () => {
    it('should return transfers module status metadata', async () => {
      const res = await request(app).get('/api/v1/transfers');
      expect(res.status).toBe(200);
      expect(res.body.module).toBe('transfers');
    });
  });

  describe('POST /api/v1/transfers', () => {
    it('should return 400 Bad Request when x-idempotency-key is missing', async () => {
      const res = await request(app).post('/api/v1/transfers').send({
        sourceWalletId: 'w1',
        destinationWalletId: 'w2',
        amount: 1000,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('is required for transfers');
    });

    it('should successfully execute transfer and return 201 Created', async () => {
      const mockResult = {
        transfer: {
          transferId: 'tr_123',
          amount: 1000,
          currency: 'INR',
          status: 'COMPLETED',
        },
        sourceBalanceAfter: 4000,
        idempotencyStatus: 'EXECUTED',
      };

      (TransferService.executeTransfer as jest.Mock).mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('x-idempotency-key', 'key-test-123')
        .send({
          sourceWalletId: '60c72b2f9b1d8b001c8b4567',
          destinationWalletId: '60c72b2f9b1d8b001c8b4568',
          amount: 1000,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.idempotencyStatus).toBe('EXECUTED');
    });

    it('should return 200 OK when transfer was replayed from idempotency', async () => {
      const mockResult = {
        transfer: {
          transferId: 'tr_123',
          amount: 1000,
          currency: 'INR',
          status: 'COMPLETED',
        },
        sourceBalanceAfter: 4000,
        idempotencyStatus: 'REPLAYED',
      };

      (TransferService.executeTransfer as jest.Mock).mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('x-idempotency-key', 'key-test-123')
        .send({
          sourceWalletId: '60c72b2f9b1d8b001c8b4567',
          destinationWalletId: '60c72b2f9b1d8b001c8b4568',
          amount: 1000,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.idempotencyStatus).toBe('REPLAYED');
    });
  });

  describe('GET /api/v1/transfers/:id', () => {
    it('should return single transfer by ID', async () => {
      const mockTransfer = {
        _id: new mongoose.Types.ObjectId(),
        transferId: 'tr_123',
        amount: 2500,
      };

      (TransferService.getTransferById as jest.Mock).mockResolvedValue(mockTransfer);

      const res = await request(app).get('/api/v1/transfers/tr_123');
      expect(res.status).toBe(200);
      expect(res.body.data.transferId).toBe('tr_123');
      expect(TransferService.getTransferById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        'tr_123',
      );
    });
  });
});
