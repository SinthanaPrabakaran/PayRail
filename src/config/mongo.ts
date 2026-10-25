import mongoose, { Connection } from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';

export interface IMongoLifecycle {
  connect(retries?: number, delayMs?: number): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): 'up' | 'down';
  checkStatus(): Promise<'up' | 'down'>;
  getConnection(): Connection;
  verifyTransactionSupport(): Promise<boolean>;
}

export class MongoConnectionManager implements IMongoLifecycle {
  private static instance: MongoConnectionManager | null = null;
  private isConnected = false;

  private constructor() {
    mongoose.connection.on('connected', () => {
      this.isConnected = true;
      logger.info('MongoDB connection established');
    });

    mongoose.connection.on('error', (err) => {
      this.isConnected = false;
      logger.error('MongoDB runtime error', { error: err.message });
    });

    mongoose.connection.on('disconnected', () => {
      this.isConnected = false;
      logger.warn('MongoDB connection lost');
    });
  }

  public static getInstance(): MongoConnectionManager {
    if (!MongoConnectionManager.instance) {
      MongoConnectionManager.instance = new MongoConnectionManager();
    }
    return MongoConnectionManager.instance;
  }

  public async connect(maxRetries = 3, retryDelayMs = 1000): Promise<void> {
    if (this.getStatus() === 'up') return;

    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      try {
        await mongoose.connect(env.MONGODB_URI, {
          serverSelectionTimeoutMS: 3000,
          connectTimeoutMS: 5000,
          socketTimeoutMS: 30000,
        });
        this.isConnected = true;
        return;
      } catch (error) {
        this.isConnected = false;
        if (attempt >= maxRetries) {
          throw new Error(
            `Failed to connect to MongoDB after ${maxRetries} attempts: ${(error as Error).message}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  public async disconnect(): Promise<void> {
    if ((mongoose.connection.readyState as number) !== 0) {
      await mongoose.disconnect();
      this.isConnected = false;
      logger.info('MongoDB connection cleanly closed');
    }
  }

  public getStatus(): 'up' | 'down' {
    return this.isConnected && (mongoose.connection.readyState as number) === 1 ? 'up' : 'down';
  }

  public async checkStatus(): Promise<'up' | 'down'> {
    try {
      if (this.getStatus() === 'up' && mongoose.connection.db) {
        await mongoose.connection.db.admin().ping();
        return 'up';
      }
      return 'down';
    } catch {
      return 'down';
    }
  }

  public getConnection(): Connection {
    return mongoose.connection;
  }

  /**
   * Verifies that the connected MongoDB deployment supports ACID multi-document transactions.
   * Transactions require a replica set or sharded cluster.
   */
  public async verifyTransactionSupport(): Promise<boolean> {
    if (this.getStatus() !== 'up' || !mongoose.connection.db) {
      await this.connect();
    }

    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const testCol = mongoose.connection.db!.collection('__tx_verify__');
      await testCol.insertOne({ probe: 'tx_check', at: new Date() }, { session });
      await session.abortTransaction();
      logger.info('MongoDB transaction capability verified successfully (replica set active)');
      return true;
    } catch (err) {
      await session.abortTransaction().catch(() => null);
      logger.error('MongoDB transactions not supported or replica set not ready', {
        err: (err as Error).message,
      });
      return false;
    } finally {
      await session.endSession();
    }
  }
}

export const mongoManager = MongoConnectionManager.getInstance();
