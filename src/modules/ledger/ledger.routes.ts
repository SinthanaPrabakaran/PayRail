import { Router } from 'express';

export const ledgerRouter = Router();

ledgerRouter.get('/', (_req, res) => {
  res.status(200).json({
    module: 'ledger',
    status: 'initialized',
    message: 'Double-entry ledger module endpoints will be implemented in subsequent phases',
  });
});
