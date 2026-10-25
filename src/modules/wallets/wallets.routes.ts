import { Router } from 'express';
import { WalletController } from './wallet.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { cacheMiddleware } from '../../middleware/cache.middleware.js';
import { rateLimiter } from '../../middleware/rateLimiter.middleware.js';

export const walletsRouter = Router();

// All wallet operations require authenticated caller
walletsRouter.use(authenticate);

// Per-user rate limiting on wallet operations: 100 requests per 60 seconds
walletsRouter.use(
  rateLimiter({
    windowSeconds: 60,
    maxRequests: 100,
    keyPrefix: 'wallets_api',
    isPerUser: true,
  }),
);

// Cache user's wallet list for 60 seconds
walletsRouter.get(
  '/',
  cacheMiddleware({
    ttlSeconds: 60,
    tagPrefix: 'wallets',
    keyGenerator: () => 'list',
  }),
  WalletController.getWallets,
);

walletsRouter.post('/', WalletController.createWallet);

// Cache individual wallet summary for 60 seconds
walletsRouter.get(
  '/:id',
  cacheMiddleware({
    ttlSeconds: 60,
    tagPrefix: 'wallets',
    keyGenerator: (req) => `summary:${req.params.id}`,
  }),
  WalletController.getWallet,
);

walletsRouter.post('/:id/deposit', WalletController.deposit);

// Cache paginated transaction history pages for 60 seconds
walletsRouter.get(
  '/:id/transactions',
  cacheMiddleware({
    ttlSeconds: 60,
    tagPrefix: 'wallets',
    keyGenerator: (req) =>
      `transactions:${req.params.id}:p${req.query.page || 1}:l${req.query.limit || 20}`,
  }),
  WalletController.getTransactions,
);

// Internal reconciliation audit is uncached for maximum real-time ledger fidelity
walletsRouter.get('/:id/reconcile', WalletController.reconcile);
