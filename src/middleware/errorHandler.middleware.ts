import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { env } from '../config/env.js';
import { ApiResponse } from '../shared/types.js';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = req.requestId;
  const timestamp = new Date().toISOString();

  // Handle AppError
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(`[AppError] ${err.message}`, { requestId, err, details: err.details });
    } else {
      logger.warn(`[AppError] ${err.message}`, {
        requestId,
        statusCode: err.statusCode,
        details: err.details,
      });
    }

    const responsePayload: ApiResponse = {
      success: false,
      error: {
        code: err.constructor.name,
        message: err.message,
        details: err.details,
      },
      meta: {
        requestId,
        timestamp,
      },
    };

    res.status(err.statusCode).json(responsePayload);
    return;
  }

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    logger.warn(`[ValidationError] Schema validation failed`, { requestId, errors: err.errors });
    const responsePayload: ApiResponse = {
      success: false,
      error: {
        code: 'ValidationError',
        message: 'Invalid request data',
        details: err.format(),
      },
      meta: {
        requestId,
        timestamp,
      },
    };

    res.status(400).json(responsePayload);
    return;
  }

  // Unhandled / Internal Server Error
  logger.error(`[UnhandledError] ${err.message}`, {
    requestId,
    stack: err.stack,
    name: err.name,
  });

  const responsePayload: ApiResponse = {
    success: false,
    error: {
      code: 'InternalServerError',
      message: env.NODE_ENV === 'production' ? 'Internal server error occurred' : err.message,
      ...(env.NODE_ENV !== 'production' && { details: err.stack }),
    },
    meta: {
      requestId,
      timestamp,
    },
  };

  res.status(500).json(responsePayload);
};
