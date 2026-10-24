import mongoose, { Document, Schema, Model } from 'mongoose';
import { Currency, SUPPORTED_CURRENCIES } from '../wallets/wallet.model.js';

export type EntryType = 'DEBIT' | 'CREDIT';

export interface ILedgerEntry {
  transactionId: string; // Grouping identifier for balanced double-entry sets
  walletId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: EntryType;
  amount: number; // Positive integer in minor units
  currency: Currency;
  description: string;
  reference?: string;
  balanceAfter: number; // Snapshotted integer balance
  createdAt: Date;
}

export interface ILedgerEntryDocument extends ILedgerEntry, Document {}

const LedgerEntrySchema = new Schema<ILedgerEntryDocument>(
  {
    transactionId: {
      type: String,
      required: true,
      index: true,
    },
    walletId: {
      type: Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['DEBIT', 'CREDIT'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Ledger entry amount must be at least 1 minor unit'],
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
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    reference: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    balanceAfter: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer balance',
      },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Append-only immutable log
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        ret.walletId = String(ret.walletId);
        ret.userId = String(ret.userId);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Immutability protection: Prevent modifications or updates to ledger records
LedgerEntrySchema.pre('updateOne', function () {
  throw new Error('Ledger entries are strictly immutable and cannot be updated');
});
LedgerEntrySchema.pre('updateMany', function () {
  throw new Error('Ledger entries are strictly immutable and cannot be updated');
});
LedgerEntrySchema.pre('findOneAndUpdate', function () {
  throw new Error('Ledger entries are strictly immutable and cannot be updated');
});

// Composite indexes for efficient, paginated transaction queries
LedgerEntrySchema.index({ walletId: 1, createdAt: -1 });
LedgerEntrySchema.index({ userId: 1, createdAt: -1 });

export const LedgerEntryModel: Model<ILedgerEntryDocument> =
  mongoose.models.LedgerEntry ||
  mongoose.model<ILedgerEntryDocument>('LedgerEntry', LedgerEntrySchema);
