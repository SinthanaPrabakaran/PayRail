import mongoose from 'mongoose';
import { CardModel, ICardDocument, CardStatus } from './card.model.js';
import { WalletService } from '../wallets/wallet.service.js';
import { CreateCardInput } from './card.schema.js';
import { NotFoundError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

export class CardService {
  /**
   * Generates a virtual simulated card record.
   * Only stores masked display data and last 4 digits; never real credentials.
   */
  public static async createVirtualCard(
    userId: string,
    input: CreateCardInput,
  ): Promise<ICardDocument> {
    // Verify wallet exists and belongs to the authenticated user
    const wallet = await WalletService.getWalletById(userId, input.walletId);

    // Generate random mock last 4 digits
    const lastFour = Math.floor(1000 + Math.random() * 9000).toString();
    const maskedPan = `•••• •••• •••• ${lastFour}`;

    const now = new Date();
    const expiryMonth = now.getMonth() + 1;
    const expiryYear = now.getFullYear() + 3; // 3-year simulated validity

    const card = await CardModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      walletId: wallet._id,
      cardholderName: input.cardholderName.trim(),
      maskedPan,
      lastFour,
      expiryMonth,
      expiryYear,
      currency: wallet.currency,
      status: 'ACTIVE',
      spendingLimit: input.spendingLimit || 0,
      isSimulated: true,
    });

    logger.info('Virtual simulated prepaid card issued', {
      userId,
      cardId: card.id,
      lastFour,
      walletId: wallet.id,
    });

    return card;
  }

  /**
   * Retrieves all virtual cards belonging to the authenticated user.
   */
  public static async getUserCards(userId: string): Promise<ICardDocument[]> {
    return CardModel.find({ userId: new mongoose.Types.ObjectId(userId) });
  }

  /**
   * Retrieves a single virtual card by ID, strictly enforcing user ownership.
   */
  public static async getCardById(userId: string, cardId: string): Promise<ICardDocument> {
    const card = await CardModel.findOne({
      _id: new mongoose.Types.ObjectId(cardId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!card) {
      throw new NotFoundError('Card not found or access unauthorized');
    }

    return card;
  }

  /**
   * Updates card status (Freeze / Unfreeze / Terminate).
   */
  public static async updateCardStatus(
    userId: string,
    cardId: string,
    status: CardStatus,
  ): Promise<ICardDocument> {
    const card = await this.getCardById(userId, cardId);

    card.status = status;
    await card.save();

    logger.info(`Prepaid card status updated to ${status}`, { cardId: card.id, userId });
    return card;
  }
}
