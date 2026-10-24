import { Request, Response, NextFunction } from 'express';
import { WalletService } from './wallet.service.js';
import { createWalletSchema, depositSchema, paginationQuerySchema } from './wallet.schema.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { ApiResponse } from '../../shared/types.js';
import { Currency } from './wallet.model.js';

export class WalletController {
  public static async getWallets(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const wallets = await WalletService.getUserWallets(req.user.userId);
      const response: ApiResponse = {
        success: true,
        data: wallets,
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async createWallet(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const { currency } = createWalletSchema.parse(req.body);
      const wallet = await WalletService.getOrCreateWallet(req.user.userId, currency as Currency);

      const response: ApiResponse = {
        success: true,
        message: 'Wallet retrieved or created successfully',
        data: wallet,
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async getWallet(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const wallet = await WalletService.getWalletById(req.user.userId, req.params.id as string);
      const response: ApiResponse = {
        success: true,
        data: wallet,
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async deposit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const { amount, reference } = depositSchema.parse(req.body);
      const result = await WalletService.depositSimulatedFunds(
        req.user.userId,
        req.params.id as string,
        amount,
        reference,
      );

      const response: ApiResponse = {
        success: true,
        message: 'Simulated dev funds credited successfully',
        data: result,
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async getTransactions(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const { page, limit } = paginationQuerySchema.parse(req.query);
      const result = await WalletService.getTransactionHistory(
        req.user.userId,
        req.params.id as string,
        page,
        limit,
      );

      const response: ApiResponse = {
        success: true,
        data: result.items,
        meta: {
          pagination: result.pagination,
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async reconcile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const result = await WalletService.reconcileWallet(req.user.userId, req.params.id as string);
      const response: ApiResponse = {
        success: true,
        data: result,
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}
