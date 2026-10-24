import { Router } from 'express';

export const transfersRouter = Router();

transfersRouter.get('/', (_req, res) => {
  res.status(200).json({
    module: 'transfers',
    status: 'initialized',
    message: 'Transfers module endpoints will be implemented in subsequent phases',
  });
});
