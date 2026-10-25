import { Request, Response, NextFunction } from 'express';
import { redisManager } from '../config/redis.js';
import { logger } from '../shared/logger.js';

export interface CacheOptions {
  ttlSeconds: number;
  keyGenerator: (req: Request) => string;
  tagPrefix?: string;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  totalLatencyMs: number;
}

// Global in-process telemetry counters (safe, non-secret metrics)
export const cacheMetrics: CacheMetrics = {
  hits: 0,
  misses: 0,
  totalLatencyMs: 0,
};

export class CacheService {
  private static readonly VERSION_PREFIX = 'payrail:cache:version:';

  /**
   * Retrieves or initializes the current numeric version for a user-scoped resource tag.
   * Useful for instant O(1) multi-key cache invalidation without expensive SCAN.
   */
  public static async getUserVersion(userId: string, resource = 'wallets'): Promise<number> {
    try {
      const client = redisManager.getClient();
      const versionKey = `${this.VERSION_PREFIX}${resource}:${userId}`;
      const v = await client.get(versionKey);
      if (!v) {
        await client.set(versionKey, '1');
        return 1;
      }
      return parseInt(v, 10);
    } catch (err) {
      logger.warn('Failed to fetch cache user version from Redis', {
        resource,
        error: (err as Error).message,
      });
      return 1;
    }
  }

  /**
   * Atomically increments the version for a user-scoped resource.
   * Instantly invalidates all cached endpoints (summaries, history pages) tied to this user and resource.
   */
  public static async bumpUserVersion(userId: string, resource = 'wallets'): Promise<void> {
    try {
      const client = redisManager.getClient();
      const versionKey = `${this.VERSION_PREFIX}${resource}:${userId}`;
      await client.incr(versionKey);
      logger.info('Cache version invalidated for user resource', { userId, resource });
    } catch (err) {
      logger.warn('Failed to bump cache version in Redis', {
        userId,
        resource,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Directly invalidates a specific cache key pattern or exact key.
   */
  public static async invalidateKey(key: string): Promise<void> {
    try {
      const client = redisManager.getClient();
      await client.del(key);
    } catch (err) {
      logger.warn('Failed to delete cache key', { key, error: (err as Error).message });
    }
  }

  /**
   * Computes current hit rate percentage.
   */
  public static getHitRate(): {
    hitRatePercent: number;
    hits: number;
    misses: number;
    avgLatencyMs: number;
  } {
    const total = cacheMetrics.hits + cacheMetrics.misses;
    const hitRatePercent = total > 0 ? (cacheMetrics.hits / total) * 100 : 0;
    const avgLatencyMs = total > 0 ? cacheMetrics.totalLatencyMs / total : 0;
    return {
      hitRatePercent: parseFloat(hitRatePercent.toFixed(2)),
      hits: cacheMetrics.hits,
      misses: cacheMetrics.misses,
      avgLatencyMs: parseFloat(avgLatencyMs.toFixed(2)),
    };
  }

  /**
   * Reset telemetry counters (e.g. before benchmark or test suite).
   */
  public static resetMetrics(): void {
    cacheMetrics.hits = 0;
    cacheMetrics.misses = 0;
    cacheMetrics.totalLatencyMs = 0;
  }
}

/**
 * Express middleware for caching read-only JSON responses with versioned user scoping.
 * Guarantees zero cross-user leakage, bounded TTLs, and graceful Redis outage failover.
 */
export function cacheMiddleware(options: CacheOptions) {
  const { ttlSeconds, keyGenerator, tagPrefix = 'wallets' } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only cache GET / HEAD requests
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    const start = Date.now();
    const userId = req.user?.userId;

    // Safety check: Authenticated endpoints require userId to prevent cross-user leakage
    if (!userId) {
      return next();
    }

    let cacheKey: string;
    try {
      const version = await CacheService.getUserVersion(userId, tagPrefix);
      const baseKey = keyGenerator(req);
      cacheKey = `payrail:cache:${tagPrefix}:u:${userId}:v:${version}:${baseKey}`;
    } catch (err) {
      logger.warn('Cache key generation failed; bypassing cache', {
        error: (err as Error).message,
      });
      return next();
    }

    try {
      const client = redisManager.getClient();
      const cachedData = await client.get(cacheKey);

      if (cachedData) {
        const elapsed = Date.now() - start;
        cacheMetrics.hits++;
        cacheMetrics.totalLatencyMs += elapsed;

        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Latency-Ms', elapsed);
        const parsed = JSON.parse(cachedData);
        return res.status(200).json(parsed) as unknown as void;
      }

      // Cache MISS
      const elapsed = Date.now() - start;
      cacheMetrics.misses++;
      cacheMetrics.totalLatencyMs += elapsed;
      res.setHeader('X-Cache', 'MISS');

      // Intercept res.json to capture response payload
      const originalJson = res.json.bind(res);
      res.json = (body: unknown): Response => {
        // Only cache 200 OK responses
        if (res.statusCode === 200 && body) {
          client.set(cacheKey, JSON.stringify(body), 'EX', ttlSeconds).catch((err) => {
            logger.warn('Failed to write response to Redis cache', {
              cacheKey,
              error: (err as Error).message,
            });
          });
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      // Redis outage safety: bypass cache silently without breaking endpoint functionality
      logger.warn('Redis cache read error, falling back to direct DB read', {
        error: (err as Error).message,
      });
      res.setHeader('X-Cache', 'BYPASS');
      next();
    }
  };
}
