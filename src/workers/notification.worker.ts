import amqplib from 'amqplib';
import { QueueManager, QUEUES } from '../queues/queue.manager.js';
import { notificationMessageSchema } from '../queues/message.schemas.js';
import { ProcessedJobModel } from '../modules/jobs/processed-job.model.js';
import { logger } from '../shared/logger.js';

export interface WorkerOptions {
  prefetch?: number;
  maxRetries?: number;
}

export class NotificationWorker {
  private isRunning = false;
  private consumerTag: string | null = null;
  private channel: amqplib.Channel | null = null;
  private readonly prefetch: number;
  private readonly maxRetries: number;

  constructor(options: WorkerOptions = {}) {
    this.prefetch = options.prefetch ?? 5;
    this.maxRetries = options.maxRetries ?? 3;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    await QueueManager.initializeTopology();
    this.channel = await QueueManager.getChannel();
    await this.channel.prefetch(this.prefetch);

    this.isRunning = true;
    logger.info('NotificationWorker started with manual acks and prefetch', {
      prefetch: this.prefetch,
      maxRetries: this.maxRetries,
    });

    const consumeResult = await this.channel.consume(
      QUEUES.NOTIFICATIONS,
      async (msg) => {
        if (!msg) return;
        await this.handleMessage(msg);
      },
      { noAck: false }, // Manual acknowledgement strictly enforced
    );

    this.consumerTag = consumeResult.consumerTag;
  }

  private async handleMessage(msg: amqplib.ConsumeMessage): Promise<void> {
    const rawContent = msg.content.toString();
    const correlationId =
      (msg.properties.headers?.correlationId as string) ||
      msg.properties.correlationId ||
      'unknown-corr-id';

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(rawContent);
    } catch (parseErr) {
      // Poison message: Non-JSON body cannot be deserialized or fixed via retries
      logger.error('Poison message: JSON parse failure; routing directly to DLQ', {
        error: (parseErr as Error).message,
        correlationId,
      });
      // nack with requeue=false routes message to Dead Letter Exchange (DLX)
      this.channel?.nack(msg, false, false);
      return;
    }

    // Validate versioned schema
    const validation = notificationMessageSchema.safeParse(parsedContent);
    if (!validation.success) {
      logger.error('Poison message: Schema validation failed; routing directly to DLQ', {
        errors: validation.error.format(),
        correlationId,
      });
      this.channel?.nack(msg, false, false);
      return;
    }

    const { eventId, payload } = validation.data;
    const currentAttempt = (msg.properties.headers?.['x-attempt-count'] as number) || 1;

    try {
      // 1. Idempotency Check: Was this notification event already successfully processed?
      const existingJob = await ProcessedJobModel.findOne({ jobId: eventId });
      if (existingJob && existingJob.status === 'PROCESSED') {
        logger.info(
          'Duplicate message detected: Notification event already processed. Skipping side-effects.',
          {
            eventId,
            correlationId,
          },
        );
        // Safely acknowledge duplicate message without repeating delivery
        this.channel?.ack(msg);
        return;
      }

      // 2. Simulated Notification Delivery (Simulates email, SMS, or in-app push)
      logger.info(
        `[SIMULATED DISPATCH] Delivering notification to recipient ${payload.recipientUserId}`,
        {
          eventId,
          correlationId,
          channel: payload.channel,
          title: payload.title,
          body: payload.body,
          attempt: currentAttempt,
        },
      );

      // 3. Record processed job for guaranteed at-most-once execution
      await ProcessedJobModel.findOneAndUpdate(
        { jobId: eventId },
        {
          jobType: 'NOTIFICATION',
          jobId: eventId,
          status: 'PROCESSED',
          attempts: currentAttempt,
          outputSummary: `Delivered via ${payload.channel}: ${payload.title}`,
          payloadSnapshot: payload,
          processedAt: new Date(),
        },
        { upsert: true, new: true },
      );

      // 4. Manual Acknowledgement ONLY after successful processing and DB persistence
      this.channel?.ack(msg);
      logger.info('Notification processed and acknowledged successfully', {
        eventId,
        correlationId,
      });
    } catch (processingErr) {
      logger.warn('Notification processing failed', {
        eventId,
        correlationId,
        currentAttempt,
        error: (processingErr as Error).message,
      });

      // 5. Bounded retries: If attempts exceed maxRetries, route to DLQ
      if (currentAttempt >= this.maxRetries) {
        logger.error('Notification retries exhausted. Routing to DLQ', {
          eventId,
          correlationId,
          totalAttempts: currentAttempt,
        });

        await ProcessedJobModel.findOneAndUpdate(
          { jobId: eventId },
          {
            jobType: 'NOTIFICATION',
            jobId: eventId,
            status: 'DEAD_LETTERED',
            attempts: currentAttempt,
            outputSummary: `Failed after ${currentAttempt} attempts: ${(processingErr as Error).message}`,
          },
          { upsert: true },
        ).catch(() => null);

        // nack with requeue=false sends to configured DLX
        this.channel?.nack(msg, false, false);
      } else {
        // Re-publish to queue with incremented attempt count and backoff delay
        const backoffMs = Math.pow(2, currentAttempt) * 500;
        setTimeout(() => {
          this.channel?.sendToQueue(QUEUES.NOTIFICATIONS, msg.content, {
            persistent: true,
            headers: {
              ...msg.properties.headers,
              'x-attempt-count': currentAttempt + 1,
            },
          });
          // Acknowledge current message from queue now that replacement is enqueued with delay
          this.channel?.ack(msg);
        }, backoffMs);
      }
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.channel && this.consumerTag) {
      await this.channel.cancel(this.consumerTag).catch(() => null);
      this.consumerTag = null;
    }
    this.isRunning = false;
    logger.info('NotificationWorker gracefully stopped');
  }

  public get running(): boolean {
    return this.isRunning;
  }
}
