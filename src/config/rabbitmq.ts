import amqplib from 'amqplib';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';

export interface IRabbitMQLifecycle {
  connect(retries?: number, delayMs?: number): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): 'up' | 'down';
  checkStatus(): Promise<'up' | 'down'>;
  getConnection(): amqplib.ChannelModel | null;
  getChannel(): Promise<amqplib.Channel>;
}

export class RabbitMQConnectionManager implements IRabbitMQLifecycle {
  private static instance: RabbitMQConnectionManager | null = null;
  private connection: amqplib.ChannelModel | null = null;
  private channel: amqplib.Channel | null = null;
  private isConnected = false;

  private constructor() {
    // Singleton
  }

  public static getInstance(): RabbitMQConnectionManager {
    if (!RabbitMQConnectionManager.instance) {
      RabbitMQConnectionManager.instance = new RabbitMQConnectionManager();
    }
    return RabbitMQConnectionManager.instance;
  }

  public async connect(maxRetries = 5, retryDelayMs = 2000): Promise<void> {
    if (this.getStatus() === 'up') return;

    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      try {
        logger.info(`Connecting to RabbitMQ (attempt ${attempt}/${maxRetries})...`);
        const conn = await amqplib.connect(env.RABBITMQ_URL, {
          timeout: 5000,
        });

        conn.on('error', (err) => {
          this.isConnected = false;
          logger.error('RabbitMQ connection error', { error: err.message });
        });

        conn.on('close', () => {
          this.isConnected = false;
          this.connection = null;
          this.channel = null;
          logger.warn('RabbitMQ connection closed');
        });

        this.connection = conn;
        this.channel = await conn.createChannel();
        this.isConnected = true;
        logger.info('RabbitMQ connection and channel established successfully');
        return;
      } catch (error) {
        this.isConnected = false;
        logger.warn(`RabbitMQ connection attempt ${attempt} failed: ${(error as Error).message}`);
        if (attempt >= maxRetries) {
          throw new Error(
            `Failed to connect to RabbitMQ after ${maxRetries} attempts: ${(error as Error).message}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close().catch(() => null);
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close().catch(() => null);
        this.connection = null;
      }
      this.isConnected = false;
      logger.info('RabbitMQ connection cleanly closed');
    } catch (err) {
      logger.error('Error closing RabbitMQ connection', { err });
    }
  }

  public getStatus(): 'up' | 'down' {
    return this.isConnected && this.connection !== null ? 'up' : 'down';
  }

  public async checkStatus(): Promise<'up' | 'down'> {
    try {
      if (this.getStatus() === 'up') return 'up';
      await this.connect(1, 1000);
      return this.getStatus();
    } catch {
      return 'down';
    }
  }

  public getConnection(): amqplib.ChannelModel | null {
    return this.connection;
  }

  public async getChannel(): Promise<amqplib.Channel> {
    if (!this.channel || !this.isConnected) {
      await this.connect();
    }
    if (!this.channel) {
      throw new Error('RabbitMQ channel is not available');
    }
    return this.channel;
  }
}

export const rabbitmqManager = RabbitMQConnectionManager.getInstance();
