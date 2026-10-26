import { Request, Response, NextFunction } from 'express';
import { AuthMiddlewareOptions } from './types.js';

export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const {
    verifyToken,
    isTokenRevoked,
    headerName = 'authorization',
    tokenPrefix = 'Bearer ',
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const headerVal = req.headers[headerName.toLowerCase()];
      if (!headerVal || typeof headerVal !== 'string') {
        res.status(401).json({
          success: false,
          error: {
            code: 'Unauthorized',
            message: 'Authentication token is missing or malformed',
          },
        });
        return;
      }

      if (!headerVal.startsWith(tokenPrefix)) {
        res.status(401).json({
          success: false,
          error: {
            code: 'Unauthorized',
            message: `Authorization header must start with '${tokenPrefix}'`,
          },
        });
        return;
      }

      const token = headerVal.slice(tokenPrefix.length).trim();
      if (!token) {
        res.status(401).json({
          success: false,
          error: {
            code: 'Unauthorized',
            message: 'Authentication token is empty',
          },
        });
        return;
      }

      const user = await verifyToken(token);
      if (!user || !user.userId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'Unauthorized',
            message: 'Invalid token payload',
          },
        });
        return;
      }

      if (isTokenRevoked && user.tokenId) {
        const revoked = await isTokenRevoked(user.tokenId);
        if (revoked) {
          res.status(401).json({
            success: false,
            error: {
              code: 'Unauthorized',
              message: 'Token has been revoked',
            },
          });
          return;
        }
      }

      (req as any).user = user;
      next();
    } catch (err: any) {
      res.status(401).json({
        success: false,
        error: {
          code: 'Unauthorized',
          message: err.message || 'Authentication failed',
        },
      });
    }
  };
}
