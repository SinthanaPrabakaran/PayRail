import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';

export interface IRedisLifecycle {
  connect(retries?: number, delayMs?: number): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): 'up' | 'down';
  checkStatus(): Promise<'up' | 'down'>;
  getClient(): Redis;
}

export class RedisConnectionManager implements IRedisLifecycle {
  private static instance: RedisConnectionManager | null = null;
  private client: Redis | null = null;
  private isConnected = false;

  private constructor() {
    // Lazy initialized on first connect call
  }

  public static getInstance(): RedisConnectionManager {
    if (!RedisConnectionManager.instance) {
      RedisConnectionManager.instance = new RedisConnectionManager();
    }
    return RedisConnectionManager.instance;
  }

  public getClient(): Redis {
    if (!this.client) {
      this.client = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD || undefined,
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 2,
        retryStrategy: (times: number) => {
          if (times > 5) return null; // stop retry loop
          return Math.min(times * 500, 2000);
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis client connected');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        logger.info('Redis client ready to process commands');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        logger.error('Redis runtime error', { error: err.message });
      });

      this.client.on('close', () => {
        this.isConnected = false;
        logger.warn('Redis connection closed');
      });
    }
    return this.client;
  }

  public async connect(maxRetries = 5, retryDelayMs = 2000): Promise<void> {
    const client = this.getClient();
    if (this.getStatus() === 'up') return;

    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      try {
        logger.info(`Connecting to Redis (attempt ${attempt}/${maxRetries})...`);
        if (client.status === 'close' || client.status === 'end' || client.status === 'wait') {
          await client.connect();
        }
        const ping = await client.ping();
        if (ping === 'PONG') {
          this.isConnected = true;
          logger.info('Redis connected and authenticated successfully');
          return;
        }
      } catch (error) {
        this.isConnected = false;
        logger.warn(`Redis connection attempt ${attempt} failed: ${(error as Error).message}`);
        if (attempt >= maxRetries) {
          throw new Error(
            `Failed to connect to Redis after ${maxRetries} attempts: ${(error as Error).message}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => this.client?.disconnect());
      this.client = null;
      this.isConnected = false;
      logger.info('Redis connection cleanly closed');
    }
  }

  public getStatus(): 'up' | 'down' {
    return this.isConnected && this.client?.status === 'ready' ? 'up' : 'down';
  }

  public async checkStatus(): Promise<'up' | 'down'> {
    try {
      const client = this.getClient();
      if (client.status === 'close' || client.status === 'end') {
        await client.connect();
      }
      const ping = await client.ping();
      this.isConnected = ping === 'PONG';
      return this.isConnected ? 'up' : 'down';
    } catch {
      this.isConnected = false;
      return 'down';
    }
  }
}

export const redisManager = RedisConnectionManager.getInstance();
