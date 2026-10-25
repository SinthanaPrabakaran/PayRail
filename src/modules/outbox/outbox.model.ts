import mongoose, { Schema, Document } from 'mongoose';

export type OutboxStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

export interface IOutboxDocument extends Document {
  eventId: string;
  topic: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  retryCount: number;
  lastError?: string;
  nextRetryAt: Date;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OutboxSchema = new Schema<IOutboxDocument>(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    topic: {
      type: String,
      required: true,
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PUBLISHED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    lastError: {
      type: String,
    },
    nextRetryAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    publishedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for outbox processor polling
OutboxSchema.index({ status: 1, nextRetryAt: 1 });

export const OutboxModel = mongoose.model<IOutboxDocument>('Outbox', OutboxSchema);
