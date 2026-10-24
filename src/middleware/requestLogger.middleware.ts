import { Request, Response, NextFunction } from 'express';
import { logger } from '../shared/logger.js';

export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();
  const { method, originalUrl, ip } = req;
  const requestId = req.requestId;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    const logMessage = `${method} ${originalUrl} ${statusCode} - ${duration}ms`;
    const metadata = { requestId, method, originalUrl, statusCode, duration, ip };

    if (statusCode >= 500) {
      logger.error(logMessage, metadata);
    } else if (statusCode >= 400) {
      logger.warn(logMessage, metadata);
    } else {
      logger.http(logMessage, metadata);
    }
  });

  next();
};
