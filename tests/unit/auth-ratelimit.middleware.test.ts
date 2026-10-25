import { Request, Response } from 'express';
import { authenticate } from '../../src/middleware/auth.middleware';
import { rateLimiter } from '../../src/middleware/rateLimiter.middleware';
import { redisManager } from '../../src/config/redis';

jest.mock('../../src/config/redis');

describe('Auth & Rate Limiter Middlewares (Unit & Branch Coverage)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    };
    nextFn = jest.fn();
  });

  describe('authenticate', () => {
    it('should return error when Bearer token is empty string', async () => {
      mockReq.headers = { authorization: 'Bearer    ' };
      await authenticate(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Authentication token is empty',
          statusCode: 401,
        }),
      );
    });

    it('should return generic Failed to authenticate token on unexpected error', async () => {
      mockReq.headers = { authorization: 'Bearer some-random-payload' };
      // Force non-standard Error
      jest.spyOn(require('../../src/shared/token'), 'verifyAccessToken').mockImplementation(() => {
        throw new Error('Some unexpected internal error');
      });

      await authenticate(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to authenticate token',
          statusCode: 401,
        }),
      );
    });
  });

  describe('rateLimiter', () => {
    it('should fall open gracefully when Redis throws an unexpected error', async () => {
      (redisManager.getClient as jest.Mock).mockReturnValue({
        eval: jest.fn().mockRejectedValue(new Error('Redis cluster connection failed')),
      });

      const limiter = rateLimiter({
        windowSeconds: 60,
        maxRequests: 5,
        keyPrefix: 'unit_test_limiter',
      });

      await limiter(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalled();
    });
  });
});
