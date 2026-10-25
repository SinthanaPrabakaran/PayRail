import { OutboxModel, IOutboxDocument } from './outbox.model.js';
import { QueueManager, EXCHANGES } from '../../queues/queue.manager.js';
import { logger } from '../../shared/logger.js';
import mongoose from 'mongoose';

export class OutboxService {
  private static isProcessing = false;

  /**
   * Enqueue a message into the outbox within an active MongoDB transaction session.
   * Guarantees atomic persistence alongside core financial mutations.
   */
  public static async enqueue(
    eventId: string,
    topic: string,
    payload: Record<string, unknown>,
    session?: mongoose.ClientSession,
  ): Promise<IOutboxDocument> {
    const [record] = await OutboxModel.create(
      [
        {
          eventId,
          topic,
          payload,
          status: 'PENDING',
          retryCount: 0,
          nextRetryAt: new Date(),
        },
      ],
      { session, ordered: true },
    );
    return record!;
  }

  /**
   * Process pending outbox entries with publisher confirms and exponential backoff.
   * If broker confirms, marks as PUBLISHED.
   * If broker fails/nacks, applies bounded retry with backoff.
   */
  public static async processOutboxBatch(
    batchSize = 20,
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (this.isProcessing) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }
    this.isProcessing = true;

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      const now = new Date();
      const pendingEvents = await OutboxModel.find({
        status: { $in: ['PENDING', 'FAILED'] },
        nextRetryAt: { $lte: now },
        retryCount: { $lt: 5 }, // Max 5 publisher retries
      })
        .limit(batchSize)
        .exec();

      for (const event of pendingEvents) {
        processed++;
        try {
          // Attempt publish with RabbitMQ publisher confirmations
          await QueueManager.publishWithConfirm(
            EXCHANGES.PAYRAIL_DIRECT,
            event.topic,
            event.payload,
            {
              eventId: event.eventId,
              correlationId: (event.payload.correlationId as string) || event.eventId,
            },
          );

          event.status = 'PUBLISHED';
          event.publishedAt = new Date();
          await event.save();
          succeeded++;
          logger.info('Outbox event published and confirmed by broker', {
            eventId: event.eventId,
            topic: event.topic,
          });
        } catch (err) {
          failed++;
          event.retryCount += 1;
          event.lastError = (err as Error).message;
          if (event.retryCount >= 5) {
            event.status = 'FAILED';
          }
          // Exponential backoff: 2s, 4s, 8s, 16s...
          const backoffSec = Math.pow(2, event.retryCount);
          event.nextRetryAt = new Date(Date.now() + backoffSec * 1000);
          await event.save();

          logger.warn('Failed to publish outbox event, scheduled retry', {
            eventId: event.eventId,
            retryCount: event.retryCount,
            nextRetryAt: event.nextRetryAt,
            error: (err as Error).message,
          });
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return { processed, succeeded, failed };
  }
}
