import mongoose, { Document, Schema, Model } from 'mongoose';
import { Currency, SUPPORTED_CURRENCIES } from '../wallets/wallet.model.js';

export type TransferStatus = 'COMPLETED' | 'FAILED';

export interface ITransfer {
  transferId: string;
  sourceWalletId: mongoose.Types.ObjectId;
  destinationWalletId: mongoose.Types.ObjectId;
  senderUserId: mongoose.Types.ObjectId;
  recipientUserId: mongoose.Types.ObjectId;
  amount: number; // Stored strictly as positive integer in minor units
  currency: Currency;
  status: TransferStatus;
  description?: string;
  reference?: string;
  ledgerTransactionId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITransferDocument extends ITransfer, Document {}

const TransferSchema = new Schema<ITransferDocument>(
  {
    transferId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sourceWalletId: {
      type: Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
      index: true,
    },
    destinationWalletId: {
      type: Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
      index: true,
    },
    senderUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recipientUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Transfer amount must be at least 1 minor unit'],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer amount',
      },
    },
    currency: {
      type: String,
      enum: SUPPORTED_CURRENCIES,
      required: true,
    },
    status: {
      type: String,
      enum: ['COMPLETED', 'FAILED'],
      required: true,
      default: 'COMPLETED',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 255,
    },
    reference: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    ledgerTransactionId: {
      type: String,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        ret.sourceWalletId = String(ret.sourceWalletId);
        ret.destinationWalletId = String(ret.destinationWalletId);
        ret.senderUserId = String(ret.senderUserId);
        ret.recipientUserId = String(ret.recipientUserId);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

TransferSchema.index({ senderUserId: 1, createdAt: -1 });
TransferSchema.index({ recipientUserId: 1, createdAt: -1 });

export const TransferModel: Model<ITransferDocument> =
  mongoose.models.Transfer || mongoose.model<ITransferDocument>('Transfer', TransferSchema);
