import { Router } from 'express';

export const notificationsRouter = Router();

notificationsRouter.get('/', (_req, res) => {
  res.status(200).json({
    module: 'notifications',
    status: 'initialized',
    message: 'Notifications module endpoints will be implemented in subsequent phases',
  });
});
