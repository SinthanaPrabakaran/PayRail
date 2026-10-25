import mongoose, { Schema, Document } from 'mongoose';

export type JobStatus = 'PROCESSED' | 'DEAD_LETTERED';

export interface IProcessedJobDocument extends Document {
  jobType: 'NOTIFICATION' | 'STATEMENT';
  jobId: string;
  status: JobStatus;
  attempts: number;
  outputSummary?: string;
  payloadSnapshot?: Record<string, unknown>;
  processedAt: Date;
  createdAt: Date;
}

const ProcessedJobSchema = new Schema<IProcessedJobDocument>(
  {
    jobType: {
      type: String,
      enum: ['NOTIFICATION', 'STATEMENT'],
      required: true,
      index: true,
    },
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['PROCESSED', 'DEAD_LETTERED'],
      required: true,
    },
    attempts: {
      type: Number,
      required: true,
      default: 1,
    },
    outputSummary: {
      type: String,
    },
    payloadSnapshot: {
      type: Schema.Types.Mixed,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

export const ProcessedJobModel = mongoose.model<IProcessedJobDocument>(
  'ProcessedJob',
  ProcessedJobSchema,
);
