import { Router } from 'express';

export const cardsRouter = Router();

cardsRouter.get('/', (_req, res) => {
  res.status(200).json({
    module: 'cards',
    status: 'initialized',
    message: 'Prepaid cards module endpoints will be implemented in subsequent phases',
  });
});
