import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';
import { registerSchema, loginSchema } from './auth.schema.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { ApiResponse } from '../../shared/types.js';

export class AuthController {
  public static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validatedInput = registerSchema.parse(req.body);
      const result = await AuthService.register(validatedInput);

      const response: ApiResponse = {
        success: true,
        message: 'User registered successfully',
        data: result,
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

  public static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validatedInput = loginSchema.parse(req.body);
      const result = await AuthService.login(validatedInput);

      const response: ApiResponse = {
        success: true,
        message: 'Authentication successful',
        data: result,
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

  public static async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Derive identity strictly from authenticated token context, NEVER client query/body params
      if (!req.user || !req.user.userId) {
        throw new UnauthorizedError('Unauthorized access');
      }

      const user = await AuthService.getProfile(req.user.userId);

      const response: ApiResponse = {
        success: true,
        data: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
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

  public static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || !req.user.tokenId) {
        throw new UnauthorizedError('Unauthorized access');
      }

      await AuthService.logout(req.user.tokenId);

      const response: ApiResponse = {
        success: true,
        message: 'Logged out successfully; token revoked',
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
