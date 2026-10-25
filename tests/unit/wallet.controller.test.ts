import { Request, Response } from 'express';
import { WalletController } from '../../src/modules/wallets/wallet.controller';
import { WalletService } from '../../src/modules/wallets/wallet.service';
import { UnauthorizedError } from '../../src/shared/errors';

jest.mock('../../src/modules/wallets/wallet.service');

describe('WalletController (Unit)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      headers: {},
      params: {},
      body: {},
      query: {},
      requestId: 'test-req-wallet',
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFn = jest.fn();
  });

  it('getWallets should throw UnauthorizedError when req.user is absent', async () => {
    await WalletController.getWallets(mockReq as Request, mockRes as Response, nextFn);
    expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('createWallet should throw UnauthorizedError when req.user is absent', async () => {
    await WalletController.createWallet(mockReq as Request, mockRes as Response, nextFn);
    expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('getWallet should throw UnauthorizedError when req.user is absent', async () => {
    await WalletController.getWallet(mockReq as Request, mockRes as Response, nextFn);
    expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('deposit should throw UnauthorizedError when req.user is absent', async () => {
    await WalletController.deposit(mockReq as Request, mockRes as Response, nextFn);
    expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('getTransactions should throw UnauthorizedError when req.user is absent', async () => {
    await WalletController.getTransactions(mockReq as Request, mockRes as Response, nextFn);
    expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('reconcile should throw UnauthorizedError when req.user is absent', async () => {
    await WalletController.reconcile(mockReq as Request, mockRes as Response, nextFn);
    expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('reconcile should succeed and return reconciliation report', async () => {
    mockReq.user = { userId: 'u1', email: 'u1@ex.com', role: 'user', tokenId: 't1' };
    mockReq.params = { id: 'w1' };
    const mockAudit = {
      isBalanced: true,
      walletBalance: 1000,
      ledgerNetTotal: 1000,
      discrepancy: 0,
    };
    (WalletService.reconcileWallet as jest.Mock).mockResolvedValue(mockAudit);

    await WalletController.reconcile(mockReq as Request, mockRes as Response, nextFn);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: mockAudit,
      }),
    );
  });
});
