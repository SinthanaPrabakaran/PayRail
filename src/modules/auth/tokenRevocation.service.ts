import { redisManager } from '../../config/redis.js';
import { logger } from '../../shared/logger.js';

const REVOKED_TOKEN_PREFIX = 'payrail:revoked_token:';

/**
 * Service to manage invalidated/logged-out JWT tokens via Redis blocklist.
 * If Redis is temporarily degraded, revocation gracefully degrades.
 */
export class TokenRevocationService {
  /**
   * Revoke a token ID (jti) for a specific TTL (seconds).
   * Usually matches remaining JWT lifetime.
   */
  public static async revokeToken(tokenId: string, ttlSeconds = 900): Promise<void> {
    try {
      const client = redisManager.getClient();
      const key = `${REVOKED_TOKEN_PREFIX}${tokenId}`;
      await client.set(key, 'revoked', 'EX', ttlSeconds);
      logger.info('Token revoked successfully', { tokenId });
    } catch (err) {
      logger.error('Failed to register token revocation in Redis', { err });
    }
  }

  /**
   * Check if a token ID (jti) has been marked revoked.
   */
  public static async isTokenRevoked(tokenId: string): Promise<boolean> {
    try {
      const client = redisManager.getClient();
      const key = `${REVOKED_TOKEN_PREFIX}${tokenId}`;
      const status = await client.get(key);
      return status === 'revoked';
    } catch (err) {
      logger.warn('Failed to verify token revocation state in Redis, allowing token check', {
        err,
      });
      return false;
    }
  }
}
