import { Router } from 'express';

export const walletsRouter = Router();

walletsRouter.get('/', (_req, res) => {
  res.status(200).json({
    module: 'wallets',
    status: 'initialized',
    message: 'Wallets module endpoints will be implemented in subsequent phases',
  });
});
