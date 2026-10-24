import mongoose from 'mongoose';
import Redis from 'ioredis';
import amqplib from 'amqplib';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';

let redisClient: Redis | null = null;
let rabbitConnection: amqplib.ChannelModel | null = null;

export const database = {
  async connectMongo(): Promise<void> {
    try {
      if (mongoose.connection.readyState === 1) return;
      await mongoose.connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 2000,
      });
      logger.info('Connected to MongoDB');
    } catch (error) {
      logger.error('Failed to connect to MongoDB', { error });
      throw error;
    }
  },

  async disconnectMongo(): Promise<void> {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      logger.info('Disconnected from MongoDB');
    }
  },

  getMongoStatus(): 'up' | 'down' {
    return mongoose.connection.readyState === 1 ? 'up' : 'down';
  },

  getRedisClient(): Redis {
    if (!redisClient) {
      redisClient = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD || undefined,
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // disable infinite auto-retry in health check context
      });

      redisClient.on('error', (err) => {
        logger.error('Redis connection error', { error: err.message });
      });
    }
    return redisClient;
  },

  async checkRedisStatus(): Promise<'up' | 'down'> {
    try {
      const client = this.getRedisClient();
      if (client.status === 'close' || client.status === 'end') {
        await client.connect();
      }
      const ping = await client.ping();
      return ping === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  },

  async closeRedis(): Promise<void> {
    if (redisClient) {
      await redisClient.quit().catch(() => redisClient?.disconnect());
      redisClient = null;
    }
  },

  async checkRabbitMQStatus(): Promise<'up' | 'down'> {
    try {
      if (!rabbitConnection) {
        rabbitConnection = await amqplib.connect(env.RABBITMQ_URL, {
          timeout: 2000,
        });
      }
      return 'up';
    } catch {
      return 'down';
    }
  },

  async closeRabbitMQ(): Promise<void> {
    if (rabbitConnection) {
      await rabbitConnection.close().catch(() => null);
      rabbitConnection = null;
    }
  },
};
