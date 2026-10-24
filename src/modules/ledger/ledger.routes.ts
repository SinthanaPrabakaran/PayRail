import { Router } from 'express';
import { LedgerEntryModel } from './ledger.model.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { paginationQuerySchema } from '../wallets/wallet.schema.js';
import { ApiResponse } from '../../shared/types.js';
import mongoose from 'mongoose';

export const ledgerRouter = Router();

ledgerRouter.use(authenticate);

/**
 * GET /api/v1/ledger
 * Returns all paginated ledger entries belonging to the authenticated user.
 */
ledgerRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = paginationQuerySchema.parse(req.query);
    const filter = { userId: new mongoose.Types.ObjectId(req.user!.userId) };
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      LedgerEntryModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      LedgerEntryModel.countDocuments(filter),
    ]);

    const response: ApiResponse = {
      success: true,
      data: items,
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
});
