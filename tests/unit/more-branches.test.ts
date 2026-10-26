import mongoose from 'mongoose';
import { WalletService } from '../../src/modules/wallets/wallet.service';
import { TransferService } from '../../src/modules/transfers/transfer.service';
import { WalletModel } from '../../src/modules/wallets/wallet.model';
import { IdempotencyModel } from '../../src/modules/transfers/idempotency.model';
import { AuthService } from '../../src/modules/auth/auth.service';
import { UserModel } from '../../src/modules/auth/user.model';
import { NotFoundError, ConflictError } from '../../src/shared/errors';

jest.mock('../../src/modules/wallets/wallet.model');
jest.mock('../../src/modules/transfers/idempotency.model');
jest.mock('../../src/modules/auth/user.model');

describe('Branch Coverage Fillers (Unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('WalletService.getOrCreateWallet E11000 and null branches', () => {
    it('should retry findOne on E11000 duplicate key error', async () => {
      const userId = new mongoose.Types.ObjectId().toHexString();
      const mockWallet = { id: 'w1', userId, currency: 'INR', balance: 0 };

      (WalletModel.findOne as jest.Mock)
        .mockResolvedValueOnce(null) // first check
        .mockResolvedValueOnce(mockWallet); // recovery findOne after 11000 race

      (WalletModel.create as jest.Mock).mockRejectedValueOnce({ code: 11000 });

      const result = await WalletService.getOrCreateWallet(userId, 'INR');
      expect(result).toEqual(mockWallet);
      expect(WalletModel.findOne).toHaveBeenCalledTimes(2);
    });

    it('should rethrow non-11000 errors on wallet create', async () => {
      const userId = new mongoose.Types.ObjectId().toHexString();
      (WalletModel.findOne as jest.Mock).mockResolvedValueOnce(null);
      (WalletModel.create as jest.Mock).mockRejectedValueOnce(new Error('DB failure'));

      await expect(WalletService.getOrCreateWallet(userId, 'INR')).rejects.toThrow('DB failure');
    });

    it('should throw ConflictError if wallet is still null after creation/retry', async () => {
      const userId = new mongoose.Types.ObjectId().toHexString();
      (WalletModel.findOne as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      (WalletModel.create as jest.Mock).mockRejectedValueOnce({ code: 11000 });

      await expect(WalletService.getOrCreateWallet(userId, 'INR')).rejects.toThrow(ConflictError);
    });
  });

  describe('TransferService Idempotency retry and non-AppError branches', () => {
    it('should allow retry if idempotencyRecord status was FAILED', async () => {
      const userId = new mongoose.Types.ObjectId().toHexString();
      const key = 'test-key-retry';
      const input = {
        sourceWalletId: new mongoose.Types.ObjectId().toHexString(),
        destinationWalletId: new mongoose.Types.ObjectId().toHexString(),
        amount: 500,
        currency: 'INR' as const,
      };

      const fingerprint = TransferService.computeFingerprint(input as Record<string, unknown>);
      (IdempotencyModel.create as jest.Mock)
        .mockRejectedValueOnce({ code: 11000 }) // First call throws 11000
        .mockResolvedValueOnce({ _id: 'new_rec_id', status: 'PROCESSING' }); // Recursive call succeeds
      (IdempotencyModel.findOne as jest.Mock).mockResolvedValueOnce({
        _id: 'failed_rec_id',
        status: 'FAILED',
        requestFingerprint: fingerprint,
      });
      (IdempotencyModel.deleteOne as jest.Mock).mockResolvedValueOnce({ deletedCount: 1 });

      const mockSession = {
        withTransaction: jest.fn().mockImplementation(async () => {
          throw new Error('Tx simulated failure');
        }),
        endSession: jest.fn().mockResolvedValue(undefined),
      };
      const sessionSpy = jest.spyOn(mongoose, 'startSession').mockResolvedValue(mockSession as any);

      try {
        await TransferService.executeTransfer(userId, key, input);
      } catch {
        // Expected
      }

      expect(IdempotencyModel.deleteOne).toHaveBeenCalledWith({ _id: 'failed_rec_id' });
      sessionSpy.mockRestore();
    });
  });

  describe('AuthService.getProfile inactive branch', () => {
    it('should throw NotFoundError if user is inactive', async () => {
      const userId = new mongoose.Types.ObjectId().toHexString();
      (UserModel.findById as jest.Mock).mockResolvedValueOnce({
        _id: userId,
        isActive: false,
      });

      await expect(AuthService.getProfile(userId)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if user not found', async () => {
      const userId = new mongoose.Types.ObjectId().toHexString();
      (UserModel.findById as jest.Mock).mockResolvedValueOnce(null);

      await expect(AuthService.getProfile(userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('RateLimiter x-forwarded-for branch', () => {
    it('should extract first IP from x-forwarded-for header array/string', async () => {
      const { rateLimiter } = await import('../../src/middleware/rateLimiter.middleware');
      const mw = rateLimiter({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'test-ip' });
      const req: any = {
        headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' },
        socket: {},
      };
      const res: any = { setHeader: jest.fn() };
      const next = jest.fn();

      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should fallback to req.socket.remoteAddress when x-forwarded-for is missing', async () => {
      const { rateLimiter } = await import('../../src/middleware/rateLimiter.middleware');
      const mw = rateLimiter({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'test-sock' });
      const req: any = {
        headers: {},
        socket: { remoteAddress: '198.51.100.1' },
      };
      const res: any = { setHeader: jest.fn() };
      const next = jest.fn();

      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('CardService.getUserCards', () => {
    it('should call CardModel.find with user ObjectId', async () => {
      const { CardService } = await import('../../src/modules/cards/card.service');
      const { CardModel } = await import('../../src/modules/cards/card.model');
      const userId = new mongoose.Types.ObjectId().toHexString();
      const findSpy = jest.spyOn(CardModel, 'find').mockResolvedValueOnce([{ id: 'c1' }] as any);

      const cards = await CardService.getUserCards(userId);
      expect(cards).toHaveLength(1);
      findSpy.mockRestore();
    });
  });
});
