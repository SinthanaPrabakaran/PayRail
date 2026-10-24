import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.js';
import { walletsRouter } from '../modules/wallets/wallets.routes.js';
import { transfersRouter } from '../modules/transfers/transfers.routes.js';
import { ledgerRouter } from '../modules/ledger/ledger.routes.js';
import { cardsRouter } from '../modules/cards/cards.routes.js';
import { notificationsRouter } from '../modules/notifications/notifications.routes.js';

export const v1Router = Router();

v1Router.get('/', (_req, res) => {
  res.status(200).json({
    version: 'v1',
    status: 'active',
    modules: ['auth', 'wallets', 'transfers', 'ledger', 'cards', 'notifications'],
  });
});

v1Router.use('/auth', authRouter);
v1Router.use('/wallets', walletsRouter);
v1Router.use('/transfers', transfersRouter);
v1Router.use('/ledger', ledgerRouter);
v1Router.use('/cards', cardsRouter);
v1Router.use('/notifications', notificationsRouter);
