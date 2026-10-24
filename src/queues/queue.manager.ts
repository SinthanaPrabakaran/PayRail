import amqplib from 'amqplib';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';

export const QUEUES = {
  NOTIFICATIONS: 'payrail.notifications',
  TRANSACTION_EVENTS: 'payrail.transfers.events',
  LEDGER_SYNC: 'payrail.ledger.sync',
} as const;

export class QueueManager {
  private static connection: amqplib.ChannelModel | null = null;
  private static channel: amqplib.Channel | null = null;

  public static async getChannel(): Promise<amqplib.Channel> {
    if (!this.channel) {
      this.connection = await amqplib.connect(env.RABBITMQ_URL);
      const ch = await this.connection.createChannel();

      for (const queueName of Object.values(QUEUES)) {
        await ch.assertQueue(queueName, { durable: true });
      }
      this.channel = ch;
      logger.info('RabbitMQ queues asserted successfully');
    }
    return this.channel;
  }

  public static async publish(queue: string, message: unknown): Promise<boolean> {
    try {
      const ch = await this.getChannel();
      return ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
        persistent: true,
      });
    } catch (error) {
      logger.error(`Failed to publish message to queue ${queue}`, { error });
      return false;
    }
  }

  public static async close(): Promise<void> {
    if (this.channel) {
      await this.channel.close().catch(() => null);
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close().catch(() => null);
      this.connection = null;
    }
  }
}
