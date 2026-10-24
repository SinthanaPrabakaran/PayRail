import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../shared/errors.js';
import { verifyAccessToken } from '../shared/token.js';
import { TokenRevocationService } from '../modules/auth/tokenRevocation.service.js';

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Authentication token is missing or malformed'));
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return next(new UnauthorizedError('Authentication token is empty'));
  }

  try {
    const payload = verifyAccessToken(token);

    // Verify token has not been revoked (e.g. logged out)
    const isRevoked = await TokenRevocationService.isTokenRevoked(payload.jti);
    if (isRevoked) {
      return next(new UnauthorizedError('Token has been revoked'));
    }

    // Attach authenticated identity to request context
    req.user = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      tokenId: payload.jti,
    };

    next();
  } catch (error) {
    const err = error as Error;
    if (err.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Token has expired'));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(new UnauthorizedError('Invalid token signature or payload'));
    }
    return next(new UnauthorizedError('Failed to authenticate token'));
  }
}
