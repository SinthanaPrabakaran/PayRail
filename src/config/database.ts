import { mongoManager } from './mongo.js';
import { redisManager } from './redis.js';
import { rabbitmqManager } from './rabbitmq.js';
import { logger } from '../shared/logger.js';

export const database = {
  // MongoDB delegates
  async connectMongo(retries?: number, delayMs?: number): Promise<void> {
    return mongoManager.connect(retries, delayMs);
  },
  async disconnectMongo(): Promise<void> {
    return mongoManager.disconnect();
  },
  getMongoStatus(): 'up' | 'down' {
    return mongoManager.getStatus();
  },
  async checkMongoStatus(): Promise<'up' | 'down'> {
    return mongoManager.checkStatus();
  },
  async verifyMongoTransactions(): Promise<boolean> {
    return mongoManager.verifyTransactionSupport();
  },

  // Redis delegates
  getRedisClient() {
    return redisManager.getClient();
  },
  async connectRedis(retries?: number, delayMs?: number): Promise<void> {
    return redisManager.connect(retries, delayMs);
  },
  async checkRedisStatus(): Promise<'up' | 'down'> {
    return redisManager.checkStatus();
  },
  async closeRedis(): Promise<void> {
    return redisManager.disconnect();
  },

  // RabbitMQ delegates
  async connectRabbitMQ(retries?: number, delayMs?: number): Promise<void> {
    return rabbitmqManager.connect(retries, delayMs);
  },
  async checkRabbitMQStatus(): Promise<'up' | 'down'> {
    return rabbitmqManager.checkStatus();
  },
  async closeRabbitMQ(): Promise<void> {
    return rabbitmqManager.disconnect();
  },

  // Global infrastructure lifecycle
  async initializeAll(
    retries = 5,
    delayMs = 2000,
  ): Promise<{
    mongo: boolean;
    redis: boolean;
    rabbitmq: boolean;
  }> {
    logger.info('Initializing all external service connections...');
    const results = { mongo: false, redis: false, rabbitmq: false };

    try {
      await mongoManager.connect(retries, delayMs);
      results.mongo = true;
    } catch (err) {
      logger.error('Failed to initialize MongoDB during startup', { err });
    }

    try {
      await redisManager.connect(retries, delayMs);
      results.redis = true;
    } catch (err) {
      logger.error('Failed to initialize Redis during startup', { err });
    }

    try {
      await rabbitmqManager.connect(retries, delayMs);
      results.rabbitmq = true;
    } catch (err) {
      logger.error('Failed to initialize RabbitMQ during startup', { err });
    }

    return results;
  },

  async teardownAll(): Promise<void> {
    logger.info('Tearing down all external service connections...');
    await Promise.allSettled([
      mongoManager.disconnect(),
      redisManager.disconnect(),
      rabbitmqManager.disconnect(),
    ]);
    logger.info('All external connections torn down cleanly');
  },
};
