import { Router, Request, Response } from 'express';
import { database } from '../config/database.js';
import { env } from '../config/env.js';

export const healthRouter = Router();

/**
 * Liveness Probe: /health
 * Indicates whether the API process is alive and receiving traffic.
 * Kubernetes/AWS ALB can use this to determine if the container needs restart.
 */
healthRouter.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    app: env.APP_NAME,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    meta: {
      requestId: req.requestId,
    },
  });
});

/**
 * Readiness Probe: /ready
 * Indicates whether the service and its core dependencies are ready to accept requests.
 * Evaluates state of MongoDB, Redis, and RabbitMQ.
 */
healthRouter.get('/ready', async (req: Request, res: Response) => {
  const mongoStatus = database.getMongoStatus();
  const redisStatus = await database.checkRedisStatus();
  const rabbitmqStatus = await database.checkRabbitMQStatus();

  // In test/mock environment, service can be marked ready or degraded cleanly
  const allServicesUp = mongoStatus === 'up' && redisStatus === 'up' && rabbitmqStatus === 'up';

  const readinessData = {
    status: allServicesUp ? 'ready' : 'degraded',
    dependencies: {
      mongodb: mongoStatus,
      redis: redisStatus,
      rabbitmq: rabbitmqStatus,
    },
    timestamp: new Date().toISOString(),
    meta: {
      requestId: req.requestId,
    },
  };

  // If critical dependencies are down, return 503 so load balancers stop routing traffic
  if (!allServicesUp) {
    res.status(503).json(readinessData);
    return;
  }

  res.status(200).json(readinessData);
});
