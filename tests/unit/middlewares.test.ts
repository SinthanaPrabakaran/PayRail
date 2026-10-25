import { Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { errorHandler } from '../../src/middleware/errorHandler.middleware';
import { notFoundHandler } from '../../src/middleware/notFound.middleware';
import { requestIdMiddleware, REQUEST_ID_HEADER } from '../../src/middleware/requestId.middleware';
import { BadRequestError, AppError } from '../../src/shared/errors';

describe('Middlewares (Unit)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: jest.Mock;

  beforeEach(() => {
    mockReq = {
      headers: {},
      method: 'GET',
      originalUrl: '/test',
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    };
    nextFn = jest.fn();
  });

  describe('requestIdMiddleware', () => {
    it('should generate a UUID when header is absent', () => {
      requestIdMiddleware(mockReq as Request, mockRes as Response, nextFn);

      expect(mockReq.requestId).toBeDefined();
      expect(typeof mockReq.requestId).toBe('string');
      expect(mockRes.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, mockReq.requestId);
      expect(nextFn).toHaveBeenCalled();
    });

    it('should reuse existing x-request-id if provided', () => {
      const incomingId = 'req-abc-123';
      mockReq.headers = { [REQUEST_ID_HEADER]: incomingId };

      requestIdMiddleware(mockReq as Request, mockRes as Response, nextFn);

      expect(mockReq.requestId).toBe(incomingId);
      expect(mockRes.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, incomingId);
      expect(nextFn).toHaveBeenCalled();
    });
  });

  describe('notFoundHandler', () => {
    it('should forward a NotFoundError with the method and route', () => {
      mockReq.method = 'POST';
      mockReq.originalUrl = '/unknown/endpoint';

      notFoundHandler(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Route POST /unknown/endpoint not found',
        }),
      );
    });
  });

  describe('errorHandler', () => {
    it('should format AppError correctly with statusCode < 500', () => {
      mockReq.requestId = 'req-123';
      const appErr = new BadRequestError('Invalid input field', { field: 'email' });

      errorHandler(appErr, mockReq as Request, mockRes as Response, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: {
            code: 'BadRequestError',
            message: 'Invalid input field',
            details: { field: 'email' },
          },
          meta: expect.objectContaining({
            requestId: 'req-123',
          }),
        }),
      );
    });

    it('should format AppError correctly with statusCode >= 500', () => {
      mockReq.requestId = 'req-500';
      const appErr = new AppError('Database connection died', 503, true, { db: 'mongo' });

      errorHandler(appErr, mockReq as Request, mockRes as Response, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: {
            code: 'AppError',
            message: 'Database connection died',
            details: { db: 'mongo' },
          },
        }),
      );
    });

    it('should format ZodError validation errors with 400', () => {
      mockReq.requestId = 'req-zod';
      const dummySchema = z.object({ amount: z.number().positive() });
      let zodErr: ZodError | null = null;
      try {
        dummySchema.parse({ amount: -50 });
      } catch (e) {
        zodErr = e as ZodError;
      }

      errorHandler(zodErr!, mockReq as Request, mockRes as Response, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'ValidationError',
            message: 'Invalid request data',
          }),
        }),
      );
    });

    it('should format unhandled errors as 500 InternalServerError', () => {
      mockReq.requestId = 'req-unknown';
      const rawError = new Error('Unexpected crash');

      errorHandler(rawError, mockReq as Request, mockRes as Response, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'InternalServerError',
          }),
        }),
      );
    });
  });
});
