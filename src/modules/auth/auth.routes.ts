import { Router } from 'express';

export const authRouter = Router();

authRouter.get('/', (_req, res) => {
  res.status(200).json({
    module: 'auth',
    status: 'initialized',
    message: 'Auth module endpoints will be implemented in subsequent phases',
  });
});
