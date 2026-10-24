import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { requestIdMiddleware } from './middleware/requestId.middleware.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.middleware.js';
import { errorHandler } from './middleware/errorHandler.middleware.js';
import { notFoundHandler } from './middleware/notFound.middleware.js';
import { healthRouter } from './routes/health.routes.js';
import { v1Router } from './routes/v1.routes.js';

export function createApp(): Express {
  const app = express();

  // Basic security and parsing middlewares
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Tracing and request profiling
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);

  // Root endpoints: Health and Readiness Probes
  app.use('/', healthRouter);

  // Versioned API Routes (/api/v1)
  app.use(env.API_PREFIX, v1Router);

  // 404 handler for unrecognized routes
  app.use(notFoundHandler);

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
}
