import { Request, Response, NextFunction } from 'express';
import { CardService } from './card.service.js';
import { createCardSchema, updateCardStatusSchema } from './card.schema.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { ApiResponse } from '../../shared/types.js';

export class CardController {
  public static async getCards(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const cards = await CardService.getUserCards(req.user.userId);
      const response: ApiResponse = {
        success: true,
        data: cards,
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

  public static async createCard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const validatedInput = createCardSchema.parse(req.body);
      const card = await CardService.createVirtualCard(req.user.userId, validatedInput);

      const response: ApiResponse = {
        success: true,
        message: 'Virtual simulated prepaid card created successfully',
        data: card,
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async getCard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const card = await CardService.getCardById(req.user.userId, req.params.id as string);
      const response: ApiResponse = {
        success: true,
        data: card,
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

  public static async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError();

      const { status } = updateCardStatusSchema.parse(req.body);
      const card = await CardService.updateCardStatus(
        req.user.userId,
        req.params.id as string,
        status,
      );

      const response: ApiResponse = {
        success: true,
        message: `Card status updated to ${status}`,
        data: card,
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
