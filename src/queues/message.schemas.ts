import { z } from 'zod';

export const baseMessageSchema = z.object({
  version: z.literal('1.0'),
  eventId: z.string().uuid(),
  correlationId: z.string().uuid(),
  timestamp: z.string().datetime(),
  producer: z.string().default('payrail-core'),
  retryCount: z.number().int().min(0).default(0),
});

export const notificationPayloadSchema = z.object({
  recipientUserId: z.string(),
  type: z.enum([
    'TRANSFER_SENT',
    'TRANSFER_RECEIVED',
    'FUNDS_DEPOSITED',
    'CARD_STATUS_CHANGED',
    'STATEMENT_READY',
  ]),
  channel: z.enum(['IN_APP', 'EMAIL_SIMULATED', 'SMS_SIMULATED']),
  title: z.string(),
  body: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const notificationMessageSchema = baseMessageSchema.extend({
  topic: z.literal('notification.dispatch'),
  payload: notificationPayloadSchema,
});

export type NotificationMessage = z.infer<typeof notificationMessageSchema>;

export const statementPayloadSchema = z.object({
  jobId: z.string().uuid(),
  userId: z.string(),
  walletId: z.string(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  format: z.enum(['JSON', 'CSV_SIMULATED']).default('JSON'),
});

export const statementMessageSchema = baseMessageSchema.extend({
  topic: z.literal('statement.generate'),
  payload: statementPayloadSchema,
});

export type StatementMessage = z.infer<typeof statementMessageSchema>;
