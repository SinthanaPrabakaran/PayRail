export interface AuthenticatedUser {
  userId: string;
  email: string;
  role?: string;
  tokenId?: string;
  [key: string]: unknown;
}

export type TokenVerifier = (token: string) => Promise<AuthenticatedUser> | AuthenticatedUser;
export type TokenRevocationCheck = (tokenId: string) => Promise<boolean> | boolean;

export interface AuthMiddlewareOptions {
  verifyToken: TokenVerifier;
  isTokenRevoked?: TokenRevocationCheck;
  headerName?: string;
  tokenPrefix?: string;
}

export interface IdempotencyStorage {
  acquireLock(
    key: string,
    fingerprint: string,
    ttlSeconds: number,
  ): Promise<{ status: 'ACQUIRED' } | { status: 'REPLAY'; statusCode: number; body: unknown; headers?: Record<string, string> } | { status: 'CONFLICT'; reason: string }>;
  saveResponse(
    key: string,
    statusCode: number,
    body: unknown,
    headers?: Record<string, string>,
    ttlSeconds?: number,
  ): Promise<void>;
  releaseLock?(key: string): Promise<void>;
}

export interface IdempotencyOptions {
  storage: IdempotencyStorage;
  headerName?: string;
  ttlSeconds?: number;
  computeFingerprint?: (body: unknown) => string;
  enforceOnMethods?: string[];
}

export interface RateLimiterStorage {
  isAllowed(
    key: string,
    windowSeconds: number,
    maxRequests: number,
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number; currentCount: number }>;
}

export interface RateLimiterOptions {
  storage: RateLimiterStorage;
  windowSeconds: number;
  maxRequests: number;
  keyPrefix: string;
  isPerUser?: boolean;
  keyGenerator?: (req: any) => string;
}
