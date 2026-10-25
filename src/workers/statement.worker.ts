import amqplib from 'amqplib';
import { QueueManager, QUEUES } from '../queues/queue.manager.js';
import { statementMessageSchema } from '../queues/message.schemas.js';
import { ProcessedJobModel } from '../modules/jobs/processed-job.model.js';
import { LedgerEntryModel } from '../modules/ledger/ledger.model.js';
import { logger } from '../shared/logger.js';
import mongoose from 'mongoose';

export interface WorkerOptions {
  prefetch?: number;
  maxRetries?: number;
}

export class StatementWorker {
  private isRunning = false;
  private consumerTag: string | null = null;
  private channel: amqplib.Channel | null = null;
  private readonly prefetch: number;
  private readonly maxRetries: number;

  constructor(options: WorkerOptions = {}) {
    this.prefetch = options.prefetch ?? 2;
    this.maxRetries = options.maxRetries ?? 3;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    await QueueManager.initializeTopology();
    this.channel = await QueueManager.getChannel();
    await this.channel.prefetch(this.prefetch);

    this.isRunning = true;
    logger.info('StatementWorker started with manual acks and prefetch', {
      prefetch: this.prefetch,
      maxRetries: this.maxRetries,
    });

    const consumeResult = await this.channel.consume(
      QUEUES.STATEMENTS,
      async (msg) => {
        if (!msg) return;
        await this.handleMessage(msg);
      },
      { noAck: false },
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
      logger.error('Poison statement message: JSON parse failure; routing directly to DLQ', {
        error: (parseErr as Error).message,
        correlationId,
      });
      this.channel?.nack(msg, false, false);
      return;
    }

    const validation = statementMessageSchema.safeParse(parsedContent);
    if (!validation.success) {
      logger.error('Poison statement message: Schema validation failed; routing directly to DLQ', {
        errors: validation.error.format(),
        correlationId,
      });
      this.channel?.nack(msg, false, false);
      return;
    }

    const { payload } = validation.data;
    const currentAttempt = (msg.properties.headers?.['x-attempt-count'] as number) || 1;

    try {
      // 1. Idempotency Check
      const existingJob = await ProcessedJobModel.findOne({ jobId: payload.jobId });
      if (existingJob && existingJob.status === 'PROCESSED') {
        logger.info('Duplicate message detected: Statement job already completed. Skipping.', {
          jobId: payload.jobId,
          correlationId,
        });
        this.channel?.ack(msg);
        return;
      }

      // 2. Query Ledger Entries for the requested wallet within date range
      const walletObjectId = new mongoose.Types.ObjectId(payload.walletId);
      const userObjectId = new mongoose.Types.ObjectId(payload.userId);
      const start = new Date(payload.startDate);
      const end = new Date(payload.endDate);

      const entries = await LedgerEntryModel.find({
        walletId: walletObjectId,
        userId: userObjectId,
        createdAt: { $gte: start, $lte: end },
      })
        .sort({ createdAt: -1 })
        .exec();

      // 3. Generate sample statement output
      const statementSummary = {
        jobId: payload.jobId,
        walletId: payload.walletId,
        userId: payload.userId,
        period: { start: payload.startDate, end: payload.endDate },
        totalTransactions: entries.length,
        generatedAt: new Date().toISOString(),
      };

      logger.info(
        '[SIMULATED STATEMENT] Account statement generated successfully',
        statementSummary,
      );

      // 4. Record processed job for idempotent replay safety
      await ProcessedJobModel.findOneAndUpdate(
        { jobId: payload.jobId },
        {
          jobType: 'STATEMENT',
          jobId: payload.jobId,
          status: 'PROCESSED',
          attempts: currentAttempt,
          outputSummary: `Generated statement containing ${entries.length} transactions`,
          payloadSnapshot: statementSummary,
          processedAt: new Date(),
        },
        { upsert: true, new: true },
      );

      // 5. Manual Acknowledgment only after state is persisted
      this.channel?.ack(msg);
      logger.info('Statement generation job completed and acknowledged', {
        jobId: payload.jobId,
        correlationId,
      });
    } catch (err) {
      logger.warn('Statement generation failed during processing', {
        jobId: payload.jobId,
        correlationId,
        currentAttempt,
        error: (err as Error).message,
      });

      if (currentAttempt >= this.maxRetries) {
        logger.error('Statement generation retries exhausted. Routing to DLQ', {
          jobId: payload.jobId,
          correlationId,
          totalAttempts: currentAttempt,
        });

        await ProcessedJobModel.findOneAndUpdate(
          { jobId: payload.jobId },
          {
            jobType: 'STATEMENT',
            jobId: payload.jobId,
            status: 'DEAD_LETTERED',
            attempts: currentAttempt,
            outputSummary: `Failed after ${currentAttempt} attempts: ${(err as Error).message}`,
          },
          { upsert: true },
        ).catch(() => null);

        this.channel?.nack(msg, false, false);
      } else {
        const backoffMs = Math.pow(2, currentAttempt) * 500;
        setTimeout(() => {
          this.channel?.sendToQueue(QUEUES.STATEMENTS, msg.content, {
            persistent: true,
            headers: {
              ...msg.properties.headers,
              'x-attempt-count': currentAttempt + 1,
            },
          });
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
    logger.info('StatementWorker gracefully stopped');
  }

  public get running(): boolean {
    return this.isRunning;
  }
}
