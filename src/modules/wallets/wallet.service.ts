import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { WalletModel, IWalletDocument, Currency } from './wallet.model.js';
import { LedgerEntryModel, ILedgerEntryDocument } from '../ledger/ledger.model.js';
import { ConflictError, NotFoundError, BadRequestError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { CacheService } from '../../middleware/cache.middleware.js';

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class WalletService {
  /**
   * Retrieves all wallets belonging to the authenticated user.
   */
  public static async getUserWallets(userId: string): Promise<IWalletDocument[]> {
    return WalletModel.find({ userId: new mongoose.Types.ObjectId(userId) });
  }

  /**
   * Retrieves or creates a wallet for an authenticated user in a specified currency.
   */
  public static async getOrCreateWallet(
    userId: string,
    currency: Currency = 'INR',
  ): Promise<IWalletDocument> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    let wallet = await WalletModel.findOne({ userId: userObjectId, currency });
    if (!wallet) {
      try {
        wallet = await WalletModel.create({
          userId: userObjectId,
          currency,
          balance: 0,
          isActive: true,
        });
        logger.info('Wallet created for user', { userId, currency, walletId: wallet.id });
        await CacheService.bumpUserVersion(userId, 'wallets');
      } catch (err: unknown) {
        if ((err as { code?: number }).code === 11000) {
          // Concurrency handling for unique index race condition
          wallet = await WalletModel.findOne({ userId: userObjectId, currency });
        } else {
          throw err;
        }
      }
    }

    if (!wallet) {
      throw new ConflictError('Failed to create or retrieve wallet');
    }

    return wallet;
  }

  /**
   * Retrieves a single wallet by ID, strictly enforcing user ownership.
   */
  public static async getWalletById(userId: string, walletId: string): Promise<IWalletDocument> {
    const wallet = await WalletModel.findOne({
      _id: new mongoose.Types.ObjectId(walletId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!wallet) {
      throw new NotFoundError('Wallet not found or access unauthorized');
    }

    return wallet;
  }

  /**
   * Simulated development funding deposit.
   * Atomic multi-document update: credits the wallet balance and creates an immutable ledger entry in a MongoDB transaction.
   */
  public static async depositSimulatedFunds(
    userId: string,
    walletId: string,
    amountMinorUnits: number,
    reference = 'DEV_TEST_FUNDING',
  ): Promise<{ wallet: IWalletDocument; ledgerEntry: ILedgerEntryDocument }> {
    if (!Number.isInteger(amountMinorUnits) || amountMinorUnits <= 0) {
      throw new BadRequestError('Deposit amount must be a positive integer in minor units');
    }

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const userObjectId = new mongoose.Types.ObjectId(userId);
      const walletObjectId = new mongoose.Types.ObjectId(walletId);

      const wallet = await WalletModel.findOne({
        _id: walletObjectId,
        userId: userObjectId,
      }).session(session);

      if (!wallet) {
        throw new NotFoundError('Wallet not found or access unauthorized');
      }

      if (!wallet.isActive) {
        throw new BadRequestError('Cannot deposit funds into an inactive wallet');
      }

      // Increment balance
      wallet.balance += amountMinorUnits;
      await wallet.save({ session });

      const transactionId = `tx_${uuidv4()}`;

      // Create immutable ledger record (CREDIT entry)
      const [ledgerEntry] = await LedgerEntryModel.create(
        [
          {
            transactionId,
            walletId: wallet._id,
            userId: userObjectId,
            type: 'CREDIT',
            amount: amountMinorUnits,
            currency: wallet.currency,
            description: `Simulated dev funding deposit [${reference}]`,
            reference,
            balanceAfter: wallet.balance,
          },
        ],
        { session },
      );

      await session.commitTransaction();
      logger.info('Simulated deposit successful', {
        userId,
        walletId: wallet.id,
        amount: amountMinorUnits,
        newBalance: wallet.balance,
      });

      // Post-commit cache invalidation: bump user's cache version
      await CacheService.bumpUserVersion(userId, 'wallets');

      return { wallet, ledgerEntry: ledgerEntry! };
    } catch (error) {
      await session.abortTransaction().catch(() => null);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Retrieves paginated transaction history for an authenticated wallet.
   */
  public static async getTransactionHistory(
    userId: string,
    walletId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<ILedgerEntryDocument>> {
    // Verify wallet ownership first
    await this.getWalletById(userId, walletId);

    const filter = {
      walletId: new mongoose.Types.ObjectId(walletId),
      userId: new mongoose.Types.ObjectId(userId),
    };

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      LedgerEntryModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      LedgerEntryModel.countDocuments(filter),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Reconciles wallet balance against the immutable ledger entries.
   * In a double-entry system, sum(CREDIT) - sum(DEBIT) must exactly equal current wallet balance.
   */
  public static async reconcileWallet(
    userId: string,
    walletId: string,
  ): Promise<{
    walletBalance: number;
    calculatedBalance: number;
    isReconciled: boolean;
    totalCredits: number;
    totalDebits: number;
  }> {
    const wallet = await this.getWalletById(userId, walletId);

    const [reconciliation] = await LedgerEntryModel.aggregate([
      {
        $match: {
          walletId: wallet._id,
          userId: new mongoose.Types.ObjectId(userId),
        },
      },
      {
        $group: {
          _id: null,
          totalCredits: {
            $sum: {
              $cond: [{ $eq: ['$type', 'CREDIT'] }, '$amount', 0],
            },
          },
          totalDebits: {
            $sum: {
              $cond: [{ $eq: ['$type', 'DEBIT'] }, '$amount', 0],
            },
          },
        },
      },
    ]);

    const totalCredits = reconciliation?.totalCredits || 0;
    const totalDebits = reconciliation?.totalDebits || 0;
    const calculatedBalance = totalCredits - totalDebits;

    return {
      walletBalance: wallet.balance,
      calculatedBalance,
      isReconciled: wallet.balance === calculatedBalance,
      totalCredits,
      totalDebits,
    };
  }
}
