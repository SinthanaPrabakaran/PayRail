import { TransferService } from '../../src/modules/transfers/transfer.service';
import { WalletModel } from '../../src/modules/wallets/wallet.model';
import { IdempotencyModel } from '../../src/modules/transfers/idempotency.model';
import { BadRequestError, NotFoundError } from '../../src/shared/errors';
import mongoose from 'mongoose';

describe('TransferService Domain Branches (Unit/Integration Mocked)', () => {
  const userId = new mongoose.Types.ObjectId().toString();

  it('should throw BadRequestError if source and destination are identical', async () => {
    const sameId = new mongoose.Types.ObjectId().toString();
    await expect(
      TransferService.executeTransfer(userId, 'k1', {
        sourceWalletId: sameId,
        destinationWalletId: sameId,
        amount: 100,
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it('getTransferById should throw NotFoundError when transfer does not exist', async () => {
    const randomId = new mongoose.Types.ObjectId().toString();
    await expect(TransferService.getTransferById(userId, randomId)).rejects.toThrow(NotFoundError);
  });
});
