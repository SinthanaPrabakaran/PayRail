import { TransferService } from '../../src/modules/transfers/transfer.service';
import { TransferModel } from '../../src/modules/transfers/transfer.model';
import { BadRequestError, NotFoundError } from '../../src/shared/errors';
import mongoose from 'mongoose';

jest.mock('../../src/modules/transfers/transfer.model');

describe('TransferService Domain Branches (Unit)', () => {
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
    (TransferModel.findOne as jest.Mock).mockResolvedValue(null);
    const randomId = new mongoose.Types.ObjectId().toString();
    await expect(TransferService.getTransferById(userId, randomId)).rejects.toThrow(NotFoundError);
  });
});
