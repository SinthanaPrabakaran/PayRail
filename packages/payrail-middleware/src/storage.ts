import { IdempotencyStorage, RateLimiterStorage } from './types.js';

interface MemoryRecord {
  fingerprint: string;
  statusCode?: number;
  body?: unknown;
  headers?: Record<string, string>;
  expiresAt: number;
}

export class MemoryIdempotencyStorage implements IdempotencyStorage {
  private records = new Map<string, MemoryRecord>();

  async acquireLock(
    key: string,
    fingerprint: string,
    ttlSeconds: number,
  ): Promise<{ status: 'ACQUIRED' } | { status: 'REPLAY'; statusCode: number; body: unknown; headers?: Record<string, string> } | { status: 'CONFLICT'; reason: string }> {
    const now = Date.now();
    const existing = this.records.get(key);

    if (existing && existing.expiresAt > now) {
      if (existing.fingerprint !== fingerprint) {
        return { status: 'CONFLICT', reason: 'Payload differs from previous request with same key' };
      }
      if (existing.statusCode !== undefined) {
        return {
          status: 'REPLAY',
          statusCode: existing.statusCode,
          body: existing.body,
          headers: existing.headers,
        };
      }
      return { status: 'CONFLICT', reason: 'A concurrent request with this key is currently executing' };
    }

    this.records.set(key, {
      fingerprint,
      expiresAt: now + ttlSeconds * 1000,
    });

    return { status: 'ACQUIRED' };
  }

  async saveResponse(
    key: string,
    statusCode: number,
    body: unknown,
    headers?: Record<string, string>,
    ttlSeconds = 86400,
  ): Promise<void> {
    const existing = this.records.get(key);
    this.records.set(key, {
      fingerprint: existing?.fingerprint || '',
      statusCode,
      body,
      headers,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async releaseLock(key: string): Promise<void> {
    this.records.delete(key);
  }
}

export class MemoryRateLimiterStorage implements RateLimiterStorage {
  private windows = new Map<string, number[]>();

  async isAllowed(
    key: string,
    windowSeconds: number,
    maxRequests: number,
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number; currentCount: number }> {
    const now = Date.now();
    const clearBefore = now - windowSeconds * 1000;

    let timestamps = this.windows.get(key) || [];
    timestamps = timestamps.filter((t) => t > clearBefore);

    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0] || now;
      const resetTime = oldest + windowSeconds * 1000;
      const retryAfter = Math.max(1, Math.ceil((resetTime - now) / 1000));
      this.windows.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: retryAfter,
        currentCount: timestamps.length,
      };
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);

    return {
      allowed: true,
      remaining: maxRequests - timestamps.length,
      retryAfterSeconds: 0,
      currentCount: timestamps.length,
    };
  }
}
