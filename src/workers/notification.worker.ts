import { QueueManager, QUEUES } from '../queues/queue.manager.js';
import { logger } from '../shared/logger.js';

export interface IWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class NotificationWorker implements IWorker {
  private isRunning = false;

  public async start(): Promise<void> {
    try {
      const channel = await QueueManager.getChannel();
      this.isRunning = true;
      logger.info('NotificationWorker started, waiting for messages...');

      await channel.consume(
        QUEUES.NOTIFICATIONS,
        async (msg) => {
          if (!msg) return;

          try {
            const content = JSON.parse(msg.content.toString());
            logger.info('Processing notification event', { payload: content });
            // Business logic for dispatching SMS/email will be hooked here in later phase
            channel.ack(msg);
          } catch (err) {
            logger.error('Error processing notification message', { err });
            // Requeue or route to Dead Letter Queue (DLQ)
            channel.nack(msg, false, false);
          }
        },
        { noAck: false },
      );
    } catch (error) {
      logger.error('NotificationWorker encountered initialization error', { error });
    }
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('NotificationWorker stopped');
  }

  public get running(): boolean {
    return this.isRunning;
  }
}
