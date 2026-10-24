import { Router } from 'express';
import { WalletController } from './wallet.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

export const walletsRouter = Router();

// All wallet operations require authenticated caller
walletsRouter.use(authenticate);

walletsRouter.get('/', WalletController.getWallets);
walletsRouter.post('/', WalletController.createWallet);
walletsRouter.get('/:id', WalletController.getWallet);
walletsRouter.post('/:id/deposit', WalletController.deposit);
walletsRouter.get('/:id/transactions', WalletController.getTransactions);
walletsRouter.get('/:id/reconcile', WalletController.reconcile);
