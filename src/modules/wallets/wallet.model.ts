import mongoose, { Document, Schema, Model } from 'mongoose';

export type Currency = 'INR' | 'USD' | 'EUR' | 'GBP';
export const SUPPORTED_CURRENCIES: Currency[] = ['INR', 'USD', 'EUR', 'GBP'];

export interface IWallet {
  userId: mongoose.Types.ObjectId;
  currency: Currency;
  balance: number; // Stored strictly as an integer in minor units (e.g. Paise, Cents). NEVER float.
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IWalletDocument extends IWallet, Document {}

const WalletSchema = new Schema<IWalletDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    currency: {
      type: String,
      enum: SUPPORTED_CURRENCIES,
      required: true,
      default: 'INR',
    },
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Wallet balance cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer value for minor monetary units',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    versionKey: 'version',
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        ret.userId = String(ret.userId);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// One wallet per currency per user
WalletSchema.index({ userId: 1, currency: 1 }, { unique: true });

export const WalletModel: Model<IWalletDocument> =
  mongoose.models.Wallet || mongoose.model<IWalletDocument>('Wallet', WalletSchema);
