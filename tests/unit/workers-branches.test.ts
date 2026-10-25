import { NotificationWorker } from '../../src/workers/notification.worker';
import { StatementWorker } from '../../src/workers/statement.worker';
import { ProcessedJobModel } from '../../src/modules/jobs/processed-job.model';

jest.mock('../../src/modules/jobs/processed-job.model');

describe('Workers Error Branches & Retries (Unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('NotificationWorker Unit Branches', () => {
    it('should nack immediately on unparseable JSON', async () => {
      const mockChannel = {
        nack: jest.fn(),
        ack: jest.fn(),
      } as any;

      const worker = new NotificationWorker({ maxRetries: 3 });
      (worker as any).channel = mockChannel;
      const msg = {
        content: Buffer.from('NOT_VALID_JSON'),
        properties: { headers: {}, correlationId: 'c1' },
      } as any;

      await (worker as any).handleMessage(msg);
      expect(mockChannel.nack).toHaveBeenCalledWith(msg, false, false);
    });

    it('should route to DLQ when max retries are exhausted on processing error', async () => {
      const mockChannel = {
        nack: jest.fn(),
        ack: jest.fn(),
      } as any;

      const worker = new NotificationWorker({ maxRetries: 3 });
      (worker as any).channel = mockChannel;
      const validMsg = {
        version: '1.0',
        eventId: '123e4567-e89b-12d3-a456-426614174000',
        correlationId: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: new Date().toISOString(),
        producer: 'payrail-test',
        retryCount: 0,
        topic: 'notification.dispatch',
        payload: {
          recipientUserId: 'u1',
          type: 'TRANSFER_SENT',
          channel: 'IN_APP',
          title: 'Test',
          body: 'Test body',
        },
      };

      const amqpMsg = {
        content: Buffer.from(JSON.stringify(validMsg)),
        properties: { headers: { 'x-attempt-count': 3 }, correlationId: 'c1' },
      } as any;

      (ProcessedJobModel.findOne as jest.Mock).mockRejectedValue(new Error('DB read crashed'));
      (ProcessedJobModel.findOneAndUpdate as jest.Mock).mockResolvedValue({});

      await (worker as any).handleMessage(amqpMsg);
      expect(mockChannel.nack).toHaveBeenCalledWith(amqpMsg, false, false);
    });
  });

  describe('StatementWorker Unit Branches', () => {
    it('should nack immediately on unparseable JSON', async () => {
      const mockChannel = {
        nack: jest.fn(),
        ack: jest.fn(),
      } as any;

      const worker = new StatementWorker({ maxRetries: 3 });
      (worker as any).channel = mockChannel;
      const msg = {
        content: Buffer.from('NOT_VALID_JSON'),
        properties: { headers: {}, correlationId: 'c2' },
      } as any;

      await (worker as any).handleMessage(msg);
      expect(mockChannel.nack).toHaveBeenCalledWith(msg, false, false);
    });

    it('should route to DLQ when max retries are exhausted on processing error', async () => {
      const mockChannel = {
        nack: jest.fn(),
        ack: jest.fn(),
      } as any;

      const worker = new StatementWorker({ maxRetries: 3 });
      (worker as any).channel = mockChannel;
      const validMsg = {
        version: '1.0',
        eventId: '123e4567-e89b-12d3-a456-426614174000',
        correlationId: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: new Date().toISOString(),
        producer: 'payrail-test',
        retryCount: 0,
        topic: 'statement.generate',
        payload: {
          jobId: '123e4567-e89b-12d3-a456-426614174002',
          userId: 'u1',
          walletId: '507f1f77bcf86cd799439011',
          startDate: new Date().toISOString(),
          endDate: new Date().toISOString(),
          format: 'JSON',
        },
      };

      const amqpMsg = {
        content: Buffer.from(JSON.stringify(validMsg)),
        properties: { headers: { 'x-attempt-count': 3 }, correlationId: 'c2' },
      } as any;

      (ProcessedJobModel.findOne as jest.Mock).mockRejectedValue(new Error('Ledger query died'));
      (ProcessedJobModel.findOneAndUpdate as jest.Mock).mockResolvedValue({});

      await (worker as any).handleMessage(amqpMsg);
      expect(mockChannel.nack).toHaveBeenCalledWith(amqpMsg, false, false);
    });
  });
});
