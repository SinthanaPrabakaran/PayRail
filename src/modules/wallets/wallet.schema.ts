import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from './wallet.model.js';

export const createWalletSchema = z.object({
  currency: z
    .enum(SUPPORTED_CURRENCIES as [string, ...string[]], {
      errorMap: () => ({ message: 'Unsupported currency. Supported: INR, USD, EUR, GBP' }),
    })
    .default('INR'),
});

export const depositSchema = z.object({
  amount: z
    .number({ required_error: 'Amount is required' })
    .int('Deposit amount must be an integer in minor units (e.g. Paise/Cents)')
    .positive('Deposit amount must be strictly greater than 0'),
  currency: z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]).optional(),
  reference: z.string().max(100).optional(),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateWalletInput = z.infer<typeof createWalletSchema>;
export type DepositInput = z.infer<typeof depositSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
