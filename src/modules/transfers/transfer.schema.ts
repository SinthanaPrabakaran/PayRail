import { z } from 'zod';

export const createTransferSchema = z.object({
  sourceWalletId: z
    .string({ required_error: 'sourceWalletId is required' })
    .min(1, 'sourceWalletId cannot be empty'),
  destinationWalletId: z
    .string({ required_error: 'destinationWalletId is required' })
    .min(1, 'destinationWalletId cannot be empty'),
  amount: z
    .number({ required_error: 'amount is required' })
    .int('Amount must be an integer in minor units (e.g. Paise, Cents)')
    .positive('Amount must be strictly greater than 0'),
  description: z.string().max(255).optional(),
  reference: z.string().max(100).optional(),
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
