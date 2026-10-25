import { Request, Response, NextFunction } from 'express';
import { redisManager } from '../config/redis.js';
import { logger } from '../shared/logger.js';

export interface RateLimiterOptions {
  windowSeconds: number;
  maxRequests: number;
  keyPrefix: string;
  isPerUser?: boolean;
}

// Atomic Lua script implementing sliding window rate limiting
// KEYS[1]: rate limit key
// ARGV[1]: current timestamp in milliseconds
// ARGV[2]: window duration in milliseconds
// ARGV[3]: max allowed requests in window
// Returns array: [allowed (1 or 0), remaining, retryAfterSeconds, currentCount]
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local clear_before = now - window

-- Remove timestamps older than current window
redis.call('ZREMRANGEBYSCORE', key, '-inf', clear_before)

-- Count existing requests in window
local current_requests = redis.call('ZCARD', key)

if current_requests < max_requests then
  -- Add current timestamp as score and member
  -- Use timestamp + micro-salt or unique sequence to avoid collisions if multiple in same ms
  local member = now .. ':' .. redis.call('INCR', key .. ':seq')
  redis.call('ZADD', key, now, member)
  -- Set TTL for window plus buffer
  redis.call('PEXPIRE', key, window + 1000)
  redis.call('PEXPIRE', key .. ':seq', window + 1000)
  return { 1, max_requests - current_requests - 1, 0, current_requests + 1 }
else
  -- Fetch earliest timestamp in current window to calculate accurate Retry-After
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after = 1
  if oldest and #oldest >= 2 then
    local oldest_time = tonumber(oldest[2])
    local reset_time = oldest_time + window
    local diff_ms = reset_time - now
    if diff_ms > 0 then
      retry_after = math.ceil(diff_ms / 1000)
    end
  end
  return { 0, 0, retry_after, current_requests }
end
`;

/**
 * Creates an Express middleware for atomic distributed rate limiting using Redis.
 * Supports per-IP (unauthenticated) or per-user (authenticated) limits.
 * Gracefully fails open or bounded if Redis is unavailable, while keeping financial correctness intact.
 */
export function rateLimiter(options: RateLimiterOptions) {
  const { windowSeconds, maxRequests, keyPrefix, isPerUser = false } = options;
  const windowMs = windowSeconds * 1000;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let identifier: string;

    if (isPerUser && req.user?.userId) {
      identifier = `usr:${req.user.userId}`;
    } else {
      // Per-IP fallback: inspect standard proxy headers or socket address
      const forwarded = req.headers['x-forwarded-for'];
      const rawIp =
        typeof forwarded === 'string'
          ? (forwarded.split(',')[0] ?? '').trim()
          : req.socket.remoteAddress || 'unknown-ip';
      const ip = rawIp || 'unknown-ip';
      identifier = `ip:${ip}`;
    }

    const key = `payrail:ratelimit:${keyPrefix}:${identifier}`;

    try {
      const client = redisManager.getClient();
      // Execute atomic Lua sliding-window rate limit check
      const result = (await client.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        Date.now().toString(),
        windowMs.toString(),
        maxRequests.toString(),
      )) as [number, number, number, number];

      const [allowed, remaining, retryAfterSeconds] = result;

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));

      if (allowed === 1) {
        return next();
      }

      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please slow down and try again later.',
          retryAfter: retryAfterSeconds,
        },
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      // Define safe behavior for Redis outages:
      // Log warning, fail-open for reads/standard calls so legitimate traffic isn't globally blackholed,
      // while critical financial operations retain their independent DB ACID integrity.
      logger.warn('Distributed rate limiter check failed due to Redis error; falling open', {
        keyPrefix,
        error: (err as Error).message,
      });
      return next();
    }
  };
}
