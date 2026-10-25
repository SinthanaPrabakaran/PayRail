import request from 'supertest';
import express from 'express';
import { notificationsRouter } from '../../src/modules/notifications/notifications.routes';
import { ledgerRouter } from '../../src/modules/ledger/ledger.routes';
import { ProcessedJobModel } from '../../src/modules/jobs/processed-job.model';
import { LedgerEntryModel } from '../../src/modules/ledger/ledger.model';
import { QueueManager } from '../../src/queues/queue.manager';
import { errorHandler } from '../../src/middleware/errorHandler.middleware';
import mongoose from 'mongoose';

jest.mock('../../src/modules/jobs/processed-job.model');
jest.mock('../../src/modules/ledger/ledger.model');
jest.mock('../../src/queues/queue.manager');
jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: '507f1f77bcf86cd799439011', email: 'user@example.com', role: 'user' };
    next();
  },
}));

describe('Notifications & Ledger Routes (Unit)', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/ledger', ledgerRouter);
  app.use(errorHandler);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/notifications', () => {
    it('should return recent processed notifications for user', async () => {
      const mockFind = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          {
            jobId: 'j1',
            jobType: 'NOTIFICATION',
            payloadSnapshot: { title: 'Transfer Sent' },
          },
        ]),
      };
      (ProcessedJobModel.find as jest.Mock).mockReturnValue(mockFind);

      const res = await request(app).get('/api/v1/notifications');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('POST /api/v1/notifications/statement-jobs', () => {
    it('should enqueue statement job and return 202 Accepted', async () => {
      (QueueManager.publishWithConfirm as jest.Mock).mockResolvedValue(true);

      const res = await request(app)
        .post('/api/v1/notifications/statement-jobs')
        .send({
          walletId: new mongoose.Types.ObjectId().toString(),
          format: 'JSON',
        });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('QUEUED');
      expect(QueueManager.publishWithConfirm).toHaveBeenCalled();
    });

    it('should return 400 for invalid wallet ObjectId', async () => {
      const res = await request(app)
        .post('/api/v1/notifications/statement-jobs')
        .send({
          walletId: 'invalid-id',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/notifications/statement-jobs/:jobId', () => {
    it('should return job if found', async () => {
      const mockJob = { jobId: 'job-123', jobType: 'STATEMENT', status: 'COMPLETED' };
      (ProcessedJobModel.findOne as jest.Mock).mockResolvedValue(mockJob);

      const res = await request(app).get('/api/v1/notifications/statement-jobs/job-123');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
    });

    it('should return PENDING_OR_QUEUED if job not yet in ProcessedJobModel', async () => {
      (ProcessedJobModel.findOne as jest.Mock).mockResolvedValue(null);

      const res = await request(app).get('/api/v1/notifications/statement-jobs/job-not-yet');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PENDING_OR_QUEUED');
    });
  });

  describe('GET /api/v1/ledger', () => {
    it('should return paginated ledger entries for authenticated user', async () => {
      const mockEntries = [
        {
          _id: new mongoose.Types.ObjectId(),
          walletId: new mongoose.Types.ObjectId(),
          type: 'CREDIT',
          amount: 5000,
        },
      ];

      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEntries),
      };

      (LedgerEntryModel.find as jest.Mock).mockReturnValue(mockQuery);
      (LedgerEntryModel.countDocuments as jest.Mock).mockResolvedValue(1);

      const res = await request(app).get('/api/v1/ledger?page=1&limit=10');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.pagination.totalPages).toBe(1);
    });
  });
});
