import mongoose, { Document, Schema, Model } from 'mongoose';
import { Currency, SUPPORTED_CURRENCIES } from '../wallets/wallet.model.js';

export type CardStatus = 'ACTIVE' | 'FROZEN' | 'TERMINATED';
export type CardType = 'VIRTUAL';

export interface ICard {
  userId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  cardholderName: string;
  maskedPan: string; // e.g. "•••• •••• •••• 1234" (Never store real card numbers)
  lastFour: string;
  expiryMonth: number;
  expiryYear: number;
  currency: Currency;
  status: CardStatus;
  spendingLimit: number; // Stored as integer minor units (0 = default unlimited)
  isSimulated: boolean; // Explicit flag ensuring simulated development designation
  createdAt: Date;
  updatedAt: Date;
}

export interface ICardDocument extends ICard, Document {}

const CardSchema = new Schema<ICardDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    walletId: {
      type: Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
      index: true,
    },
    cardholderName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    maskedPan: {
      type: String,
      required: true,
    },
    lastFour: {
      type: String,
      required: true,
      minlength: 4,
      maxlength: 4,
    },
    expiryMonth: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    expiryYear: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      enum: SUPPORTED_CURRENCIES,
      required: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'FROZEN', 'TERMINATED'],
      default: 'ACTIVE',
    },
    spendingLimit: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer spending limit',
      },
    },
    isSimulated: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        ret.userId = String(ret.userId);
        ret.walletId = String(ret.walletId);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

CardSchema.index({ userId: 1, status: 1 });

export const CardModel: Model<ICardDocument> =
  mongoose.models.Card || mongoose.model<ICardDocument>('Card', CardSchema);
