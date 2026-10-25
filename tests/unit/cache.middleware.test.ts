import { Request, Response } from 'express';
import { cacheMiddleware, CacheService } from '../../src/middleware/cache.middleware';
import { redisManager } from '../../src/config/redis';

jest.mock('../../src/config/redis');

describe('Cache Middleware Unit & Branch Coverage (Unit)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: jest.Mock;
  let mockRedisClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
      incr: jest.fn(),
      del: jest.fn(),
    };
    (redisManager.getClient as jest.Mock).mockReturnValue(mockRedisClient);

    mockReq = {
      method: 'POST',
      headers: {},
      user: { userId: 'u123', email: 'u@ex.com', role: 'user', tokenId: 't1' },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    };
    nextFn = jest.fn();
  });

  it('should immediately call next() for non-GET requests (e.g. POST)', async () => {
    const middleware = cacheMiddleware({
      ttlSeconds: 60,
      keyGenerator: () => 'test_key',
    });

    await middleware(mockReq as Request, mockRes as Response, nextFn);
    expect(nextFn).toHaveBeenCalled();
    expect(mockRedisClient.get).not.toHaveBeenCalled();
  });

  it('should immediately call next() when req.user is absent', async () => {
    mockReq.method = 'GET';
    mockReq.user = undefined;

    const middleware = cacheMiddleware({
      ttlSeconds: 60,
      keyGenerator: () => 'test_key',
    });

    await middleware(mockReq as Request, mockRes as Response, nextFn);
    expect(nextFn).toHaveBeenCalled();
  });

  it('should handle keyGenerator throwing error gracefully by calling next()', async () => {
    mockReq.method = 'GET';
    const middleware = cacheMiddleware({
      ttlSeconds: 60,
      keyGenerator: () => {
        throw new Error('Key generator exploded');
      },
    });

    await middleware(mockReq as Request, mockRes as Response, nextFn);
    expect(nextFn).toHaveBeenCalled();
  });

  it('should handle Redis read exception by setting X-Cache BYPASS and calling next()', async () => {
    mockReq.method = 'GET';
    mockRedisClient.get.mockRejectedValue(new Error('Redis connection timed out'));

    const middleware = cacheMiddleware({
      ttlSeconds: 60,
      keyGenerator: () => 'summary',
    });

    await middleware(mockReq as Request, mockRes as Response, nextFn);
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Cache', 'BYPASS');
    expect(nextFn).toHaveBeenCalled();
  });

  it('CacheService should safely handle Redis error during getUserVersion and return default 1', async () => {
    mockRedisClient.get.mockRejectedValue(new Error('Redis down'));
    const version = await CacheService.getUserVersion('u-err');
    expect(version).toBe(1);
  });

  it('CacheService should safely handle Redis error during bumpUserVersion without throwing', async () => {
    mockRedisClient.incr.mockRejectedValue(new Error('Redis down'));
    await expect(CacheService.bumpUserVersion('u-err')).resolves.not.toThrow();
  });

  it('CacheService should safely handle Redis error during invalidateKey without throwing', async () => {
    mockRedisClient.del.mockRejectedValue(new Error('Redis down'));
    await expect(CacheService.invalidateKey('k-err')).resolves.not.toThrow();
  });
});
