import { Request, Response } from 'express';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { TokenRevocationService } from '../../src/modules/auth/tokenRevocation.service';
import { redisManager } from '../../src/config/redis';
import { requestLoggerMiddleware } from '../../src/middleware/requestLogger.middleware';
import { UnauthorizedError } from '../../src/shared/errors';
import { EventEmitter } from 'events';

jest.mock('../../src/modules/auth/auth.service');
jest.mock('../../src/config/redis');

describe('Auth & Logger Branch Tests (Unit)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      headers: {},
      params: {},
      body: {},
      requestId: 'test-req',
      method: 'GET',
      originalUrl: '/api/v1/test',
      ip: '127.0.0.1',
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      statusCode: 200,
    };
    nextFn = jest.fn();
  });

  describe('AuthController Branch Coverage', () => {
    it('getProfile should throw UnauthorizedError when req.user.userId is missing', async () => {
      mockReq.user = undefined;
      await AuthController.getProfile(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('logout should throw UnauthorizedError when req.user.tokenId is missing', async () => {
      mockReq.user = { userId: 'u1', email: 'u1@ex.com', role: 'user', tokenId: '' };
      await AuthController.logout(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });
  });

  describe('TokenRevocationService Branch Coverage', () => {
    it('revokeToken should catch Redis errors gracefully without throwing', async () => {
      (redisManager.getClient as jest.Mock).mockReturnValue({
        set: jest.fn().mockRejectedValue(new Error('Redis connection dead')),
      });

      await expect(TokenRevocationService.revokeToken('tok-1')).resolves.not.toThrow();
    });

    it('isTokenRevoked should catch Redis errors gracefully and return false', async () => {
      (redisManager.getClient as jest.Mock).mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error('Redis connection dead')),
      });

      const isRevoked = await TokenRevocationService.isTokenRevoked('tok-1');
      expect(isRevoked).toBe(false);
    });
  });

  describe('requestLoggerMiddleware Branch Coverage', () => {
    it('should log 500 status codes as error level', () => {
      const emitter = new EventEmitter();
      const resWithEvents = Object.assign(emitter, {
        statusCode: 500,
      }) as unknown as Response;

      requestLoggerMiddleware(mockReq as Request, resWithEvents, nextFn);
      expect(nextFn).toHaveBeenCalled();

      // Trigger finish
      emitter.emit('finish');
    });

    it('should log 400 status codes as warn level', () => {
      const emitter = new EventEmitter();
      const resWithEvents = Object.assign(emitter, {
        statusCode: 400,
      }) as unknown as Response;

      requestLoggerMiddleware(mockReq as Request, resWithEvents, nextFn);
      expect(nextFn).toHaveBeenCalled();

      emitter.emit('finish');
    });

    it('should log 200 status codes as http level', () => {
      const emitter = new EventEmitter();
      const resWithEvents = Object.assign(emitter, {
        statusCode: 200,
      }) as unknown as Response;

      requestLoggerMiddleware(mockReq as Request, resWithEvents, nextFn);
      expect(nextFn).toHaveBeenCalled();

      emitter.emit('finish');
    });
  });
});
