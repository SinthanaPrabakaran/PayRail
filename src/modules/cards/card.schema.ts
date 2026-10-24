import { z } from 'zod';

export const createCardSchema = z.object({
  walletId: z.string().min(1, 'walletId is required'),
  cardholderName: z.string().trim().min(1, 'Cardholder name is required').max(100),
  spendingLimit: z
    .number()
    .int('Spending limit must be an integer minor unit')
    .min(0, 'Spending limit cannot be negative')
    .default(0),
});

export const updateCardStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'FROZEN', 'TERMINATED'], {
    errorMap: () => ({ message: 'Status must be ACTIVE, FROZEN, or TERMINATED' }),
  }),
});

export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardStatusInput = z.infer<typeof updateCardStatusSchema>;
