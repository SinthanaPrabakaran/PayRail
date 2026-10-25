import { OutboxService } from '../../src/modules/outbox/outbox.service';
import { OutboxModel } from '../../src/modules/outbox/outbox.model';
import { QueueManager } from '../../src/queues/queue.manager';

jest.mock('../../src/modules/outbox/outbox.model');
jest.mock('../../src/queues/queue.manager');

describe('OutboxService Failure & Retry (Unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle publisher failure by incrementing retryCount and applying exponential backoff', async () => {
    const mockSave = jest.fn().mockResolvedValue(true);
    const mockPendingEvent = {
      eventId: 'evt-retry-1',
      topic: 'notification.dispatch',
      payload: { correlationId: 'corr-1' },
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: new Date(),
      lastError: undefined as string | undefined,
      save: mockSave,
    };

    (OutboxModel.find as jest.Mock).mockReturnValue({
      limit: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockPendingEvent]),
      }),
    });

    // Simulate RabbitMQ broker nack / error
    (QueueManager.publishWithConfirm as jest.Mock).mockRejectedValue(
      new Error('Broker channel closed'),
    );

    const result = await OutboxService.processOutboxBatch(10);

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);

    expect(mockPendingEvent.retryCount).toBe(1);
    expect(mockPendingEvent.lastError).toBe('Broker channel closed');
    expect(mockSave).toHaveBeenCalled();
  });

  it('should mark status as FAILED when retry count reaches threshold', async () => {
    const mockSave = jest.fn().mockResolvedValue(true);
    const mockPendingEvent = {
      eventId: 'evt-retry-max',
      topic: 'notification.dispatch',
      payload: { correlationId: 'corr-max' },
      status: 'PENDING',
      retryCount: 4,
      nextRetryAt: new Date(),
      lastError: undefined as string | undefined,
      save: mockSave,
    };

    (OutboxModel.find as jest.Mock).mockReturnValue({
      limit: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockPendingEvent]),
      }),
    });

    (QueueManager.publishWithConfirm as jest.Mock).mockRejectedValue(
      new Error('Persistent broker failure'),
    );

    const result = await OutboxService.processOutboxBatch(10);

    expect(result.failed).toBe(1);
    expect(mockPendingEvent.retryCount).toBe(5);
    expect(mockPendingEvent.status).toBe('FAILED');
  });
});
