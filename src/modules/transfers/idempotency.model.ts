import mongoose, { Document, Schema, Model } from 'mongoose';

export type IdempotencyStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface IIdempotencyRecord {
  userId: mongoose.Types.ObjectId;
  key: string;
  operation: string; // e.g. "TRANSFERS:CREATE"
  requestFingerprint: string; // SHA-256 hash of normalized request body
  status: IdempotencyStatus;
  statusCode?: number;
  responseBody?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IIdempotencyDocument extends IIdempotencyRecord, Document {}

const IdempotencyRecordSchema = new Schema<IIdempotencyDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    operation: {
      type: String,
      required: true,
      trim: true,
    },
    requestFingerprint: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['PROCESSING', 'COMPLETED', 'FAILED'],
      required: true,
      default: 'PROCESSING',
    },
    statusCode: {
      type: Number,
    },
    responseBody: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  },
);

// Unique compound index: Scoped strictly per user, per operation, per key.
// Guarantees atomic insertion lock in MongoDB.
IdempotencyRecordSchema.index({ userId: 1, operation: 1, key: 1 }, { unique: true });

// TTL index: Automatically expires and cleans up completed records after 7 days (604800 seconds)
IdempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });

export const IdempotencyModel: Model<IIdempotencyDocument> =
  mongoose.models.IdempotencyRecord ||
  mongoose.model<IIdempotencyDocument>('IdempotencyRecord', IdempotencyRecordSchema);
