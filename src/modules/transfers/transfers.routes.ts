import { Router } from 'express';
import { TransferController } from './transfer.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

export const transfersRouter = Router();

// All transfer operations require authenticated identity
transfersRouter.use(authenticate);

transfersRouter.get('/', (_req, res) => {
  res.status(200).json({
    module: 'transfers',
    status: 'active',
    endpoints: ['POST / (Requires x-idempotency-key)', 'GET /:id'],
  });
});

transfersRouter.post('/', TransferController.createTransfer);
transfersRouter.get('/:id', TransferController.getTransfer);
