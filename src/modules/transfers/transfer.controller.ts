import { Request, Response, NextFunction } from 'express';
import { TransferService } from './transfer.service.js';
import { createTransferSchema } from './transfer.schema.js';
import { BadRequestError, UnauthorizedError } from '../../shared/errors.js';
import { ApiResponse } from '../../shared/types.js';

export const IDEMPOTENCY_HEADER = 'x-idempotency-key';

export class TransferController {
  public static async createTransfer(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      // Require Idempotency-Key on transfer creation
      const idempotencyKey = req.headers[IDEMPOTENCY_HEADER] as string;
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new BadRequestError(`Header '${IDEMPOTENCY_HEADER}' is required for transfers`);
      }

      const validatedInput = createTransferSchema.parse(req.body);
      const result = await TransferService.executeTransfer(
        req.user.userId,
        idempotencyKey.trim(),
        validatedInput,
      );

      const response: ApiResponse = {
        success: true,
        message:
          result.idempotencyStatus === 'EXECUTED'
            ? 'Transfer completed successfully'
            : 'Transfer response replayed from original idempotency record',
        data: result,
        meta: {
          idempotencyStatus: result.idempotencyStatus,
          idempotencyKey: idempotencyKey.trim(),
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };

      res.status(result.idempotencyStatus === 'EXECUTED' ? 201 : 200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async getTransfer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const transfer = await TransferService.getTransferById(
        req.user.userId,
        req.params.id as string,
      );

      const response: ApiResponse = {
        success: true,
        data: transfer,
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}
