import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { IdempotencyOptions } from './types.js';

export function defaultFingerprint(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return crypto.createHash('sha256').update(String(body || '')).digest('hex');
  }
  const keys = Object.keys(body as Record<string, unknown>).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) {
    sorted[k] = (body as Record<string, unknown>)[k];
  }
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

export function createIdempotencyMiddleware(options: IdempotencyOptions) {
  const {
    storage,
    headerName = 'x-idempotency-key',
    ttlSeconds = 86400,
    computeFingerprint = defaultFingerprint,
    enforceOnMethods = ['POST', 'PUT', 'PATCH'],
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!enforceOnMethods.includes(req.method.toUpperCase())) {
      return next();
    }

    const key = req.headers[headerName.toLowerCase()];
    if (!key || typeof key !== 'string' || !key.trim()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'BadRequest',
          message: `Header '${headerName}' is required for ${req.method} requests`,
        },
      });
      return;
    }

    const cleanKey = key.trim();
    // Scope by userId if authenticated, else global key
    const userScope = (req as any).user?.userId ? `${(req as any).user.userId}:` : '';
    const scopedKey = `idemp:${userScope}${cleanKey}`;
    const fingerprint = computeFingerprint(req.body);

    try {
      const lockResult = await storage.acquireLock(scopedKey, fingerprint, ttlSeconds);

      if (lockResult.status === 'CONFLICT') {
        res.status(409).json({
          success: false,
          error: {
            code: 'Conflict',
            message: lockResult.reason || 'Idempotency conflict: payload differs from original request or concurrent lock held',
          },
        });
        return;
      }

      if (lockResult.status === 'REPLAY') {
        res.setHeader('X-Cache-Lookup', 'IDEMPOTENT-REPLAY');
        if (lockResult.headers) {
          for (const [hK, hV] of Object.entries(lockResult.headers)) {
            res.setHeader(hK, hV);
          }
        }
        res.status(lockResult.statusCode).json(lockResult.body);
        return;
      }

      // Intercept res.json and res.send to save response before sending
      const originalJson = res.json.bind(res);
      let isSaved = false;

      res.json = (body: unknown): Response => {
        if (!isSaved) {
          isSaved = true;
          // Asynchronously save response payload in storage
          storage.saveResponse(scopedKey, res.statusCode, body, undefined, ttlSeconds).catch(() => null);
        }
        return originalJson(body);
      };

      next();
    } catch (err: any) {
      if (storage.releaseLock) {
        await storage.releaseLock(scopedKey).catch(() => null);
      }
      next(err);
    }
  };
}
