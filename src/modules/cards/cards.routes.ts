import { Router } from 'express';
import { CardController } from './card.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

export const cardsRouter = Router();

// All card endpoints require authenticated user identity
cardsRouter.use(authenticate);

cardsRouter.get('/', CardController.getCards);
cardsRouter.post('/', CardController.createCard);
cardsRouter.get('/:id', CardController.getCard);
cardsRouter.patch('/:id/status', CardController.updateStatus);
