import { Request, Response, NextFunction } from 'express';
import { RateLimiterOptions } from './types.js';

export function createRateLimiterMiddleware(options: RateLimiterOptions) {
  const {
    storage,
    windowSeconds,
    maxRequests,
    keyPrefix,
    isPerUser = false,
    keyGenerator,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let identifier: string;

    if (keyGenerator) {
      identifier = keyGenerator(req);
    } else if (isPerUser && (req as any).user?.userId) {
      identifier = `usr:${(req as any).user.userId}`;
    } else {
      const forwarded = req.headers['x-forwarded-for'];
      const rawIp =
        typeof forwarded === 'string'
          ? (forwarded.split(',')[0] ?? '').trim()
          : req.socket.remoteAddress || 'unknown-ip';
      identifier = `ip:${rawIp || 'unknown-ip'}`;
    }

    const key = `ratelimit:${keyPrefix}:${identifier}`;

    try {
      const result = await storage.isAllowed(key, windowSeconds, maxRequests);

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfterSeconds);
        res.status(429).json({
          success: false,
          error: {
            code: 'TooManyRequests',
            message: 'Too many requests; please slow down and retry later',
            retryAfterSeconds: result.retryAfterSeconds,
          },
        });
        return;
      }

      next();
    } catch (err) {
      // Safe fail-open default: Redis or storage outage must not bring down the service
      next();
    }
  };
}
