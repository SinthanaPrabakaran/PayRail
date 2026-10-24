import http from 'http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './shared/logger.js';
import { database } from './config/database.js';

const app = createApp();
const server = http.createServer(app);

async function startServer(): Promise<void> {
  try {
    // Attempt database connections in production or when explicitly configured
    if (env.NODE_ENV === 'production') {
      await database.connectMongo();
    }

    server.listen(env.PORT, () => {
      logger.info(
        `🚀 ${env.APP_NAME} service listening on port ${env.PORT} in ${env.NODE_ENV} mode`,
      );
      logger.info(`👉 Healthcheck: http://localhost:${env.PORT}/health`);
      logger.info(`👉 Readiness:   http://localhost:${env.PORT}/ready`);
      logger.info(`👉 API v1:      http://localhost:${env.PORT}${env.API_PREFIX}`);
    });
  } catch (error) {
    logger.error('Fatal error during application startup', { error });
    process.exit(1);
  }
}

// Graceful shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await database.disconnectMongo();
      await database.closeRedis();
      await database.closeRabbitMQ();
      logger.info('External resources closed cleanly. Exiting.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful resource teardown', { err });
      process.exit(1);
    }
  });

  // Force shutdown after timeout
  setTimeout(() => {
    logger.error('Graceful shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

void startServer();
