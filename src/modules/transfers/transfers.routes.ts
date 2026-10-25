import { Router } from 'express';
import { TransferController } from './transfer.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { rateLimiter } from '../../middleware/rateLimiter.middleware.js';

export const transfersRouter = Router();

// All transfer operations require authenticated identity
transfersRouter.use(authenticate);

// Per-user rate limiting on financial transfer creation: 60 requests per 60 seconds
transfersRouter.use(
  rateLimiter({
    windowSeconds: 60,
    maxRequests: 60,
    keyPrefix: 'transfers_api',
    isPerUser: true,
  }),
);

transfersRouter.get('/', (_req, res) => {
  res.status(200).json({
    module: 'transfers',
    status: 'active',
    endpoints: ['POST / (Requires x-idempotency-key)', 'GET /:id'],
  });
});

transfersRouter.post('/', TransferController.createTransfer);
transfersRouter.get('/:id', TransferController.getTransfer);
