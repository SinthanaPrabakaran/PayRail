import amqplib from 'amqplib';
import { rabbitmqManager } from '../config/rabbitmq.js';
import { logger } from '../shared/logger.js';

export const EXCHANGES = {
  PAYRAIL_DIRECT: 'payrail.direct',
  PAYRAIL_DLX: 'payrail.dlx',
} as const;

export const QUEUES = {
  NOTIFICATIONS: 'payrail.notifications',
  STATEMENTS: 'payrail.statements',
  DEAD_LETTER: 'payrail.dead_letter',
  TRANSACTION_EVENTS: 'payrail.transfers.events',
  LEDGER_SYNC: 'payrail.ledger.sync',
} as const;

export const ROUTING_KEYS = {
  NOTIFICATION: 'notification.dispatch',
  STATEMENT: 'statement.generate',
  DEAD_LETTER: 'dead_letter',
} as const;

export class QueueManager {
  private static confirmChannel: amqplib.ConfirmChannel | null = null;
  private static regularChannel: amqplib.Channel | null = null;
  private static initialized = false;

  /**
   * Initializes durable exchanges, queues, dead-letter routing, and bindings.
   */
  public static async initializeTopology(): Promise<void> {
    if (this.initialized) return;

    const ch = await this.getChannel();

    // 1. Declare Dead Letter Exchange (DLX) and Queue
    await ch.assertExchange(EXCHANGES.PAYRAIL_DLX, 'direct', { durable: true });
    await ch.assertQueue(QUEUES.DEAD_LETTER, { durable: true });
    await ch.bindQueue(QUEUES.DEAD_LETTER, EXCHANGES.PAYRAIL_DLX, ROUTING_KEYS.DEAD_LETTER);

    // 2. Declare Main Direct Exchange
    await ch.assertExchange(EXCHANGES.PAYRAIL_DIRECT, 'direct', { durable: true });

    // 3. Declare durable Queues configured with Dead-Letter Exchange (DLX)
    await ch.assertQueue(QUEUES.NOTIFICATIONS, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': EXCHANGES.PAYRAIL_DLX,
        'x-dead-letter-routing-key': ROUTING_KEYS.DEAD_LETTER,
      },
    });
    await ch.bindQueue(QUEUES.NOTIFICATIONS, EXCHANGES.PAYRAIL_DIRECT, ROUTING_KEYS.NOTIFICATION);

    await ch.assertQueue(QUEUES.STATEMENTS, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': EXCHANGES.PAYRAIL_DLX,
        'x-dead-letter-routing-key': ROUTING_KEYS.DEAD_LETTER,
      },
    });
    await ch.bindQueue(QUEUES.STATEMENTS, EXCHANGES.PAYRAIL_DIRECT, ROUTING_KEYS.STATEMENT);

    // Legacy / Auxiliary queues
    await ch.assertQueue(QUEUES.TRANSACTION_EVENTS, { durable: true });
    await ch.assertQueue(QUEUES.LEDGER_SYNC, { durable: true });

    this.initialized = true;
    logger.info('RabbitMQ enterprise topology & DLX bindings initialized successfully');
  }

  /**
   * Returns regular channel for consumer usage.
   */
  public static async getChannel(): Promise<amqplib.Channel> {
    if (!this.regularChannel) {
      this.regularChannel = await rabbitmqManager.getChannel();
    }
    return this.regularChannel;
  }

  /**
   * Returns a ConfirmChannel for reliable publisher confirms.
   */
  public static async getConfirmChannel(): Promise<amqplib.ConfirmChannel> {
    if (!this.confirmChannel) {
      const conn = rabbitmqManager.getConnection();
      if (!conn) {
        await rabbitmqManager.connect(3, 1000);
      }
      const activeConn = rabbitmqManager.getConnection();
      if (!activeConn) {
        throw new Error('RabbitMQ connection unavailable for confirm channel');
      }
      this.confirmChannel = await activeConn.createConfirmChannel();
      logger.info('RabbitMQ ConfirmChannel created for publisher confirmations');
    }
    return this.confirmChannel;
  }

  /**
   * Publishes message with publisher confirms and persistent delivery mode.
   * Resolves only after RabbitMQ broker acknowledges message persistence to disk.
   */
  public static async publishWithConfirm(
    exchange: string,
    routingKey: string,
    message: unknown,
    headers: Record<string, unknown> = {},
  ): Promise<boolean> {
    await this.initializeTopology();
    const ch = await this.getConfirmChannel();

    return new Promise((resolve, reject) => {
      const buffer = Buffer.from(JSON.stringify(message));
      ch.publish(
        exchange,
        routingKey,
        buffer,
        {
          persistent: true,
          contentType: 'application/json',
          headers,
          timestamp: Date.now(),
        },
        (err) => {
          if (err) {
            logger.error('RabbitMQ publisher nack or write failure', {
              exchange,
              routingKey,
              error: err.message,
            });
            return reject(err);
          }
          resolve(true);
        },
      );
    });
  }

  /**
   * Legacy direct queue publisher for backward compatibility.
   */
  public static async publish(queue: string, message: unknown): Promise<boolean> {
    try {
      await this.initializeTopology();
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
    if (this.confirmChannel) {
      await this.confirmChannel.close().catch(() => null);
      this.confirmChannel = null;
    }
    if (this.regularChannel) {
      await this.regularChannel.close().catch(() => null);
      this.regularChannel = null;
    }
    this.initialized = false;
    await rabbitmqManager.disconnect();
  }
}
