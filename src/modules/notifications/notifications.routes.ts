import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { ProcessedJobModel } from '../jobs/processed-job.model.js';
import { QueueManager, EXCHANGES, ROUTING_KEYS } from '../../queues/queue.manager.js';
import { ApiResponse } from '../../shared/types.js';
import { BadRequestError, UnauthorizedError } from '../../shared/errors.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

export const notificationsRouter = Router();

const requestStatementSchema = z.object({
  walletId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid wallet ObjectId'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  format: z.enum(['JSON', 'CSV_SIMULATED']).default('JSON'),
});

notificationsRouter.use(authenticate);

/**
 * GET /api/v1/notifications
 * Lists recent processed notifications for the authenticated user
 */
notificationsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError();

      const jobs = await ProcessedJobModel.find({
        jobType: 'NOTIFICATION',
        'payloadSnapshot.recipientUserId': req.user.userId,
      })
        .sort({ createdAt: -1 })
        .limit(50);

      const response: ApiResponse = {
        success: true,
        data: jobs,
        meta: {
          total: jobs.length,
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/notifications/statement-jobs
 * Dispatches an asynchronous statement generation job via RabbitMQ publisher confirms
 */
notificationsRouter.post(
  '/statement-jobs',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError();

      const body = requestStatementSchema.parse(req.body);
      const jobId = uuidv4();
      const correlationId = (req.requestId as string) || uuidv4();

      const statementMessage = {
        version: '1.0' as const,
        eventId: jobId,
        correlationId,
        timestamp: new Date().toISOString(),
        producer: 'payrail-api',
        retryCount: 0,
        topic: 'statement.generate' as const,
        payload: {
          jobId,
          userId: req.user.userId,
          walletId: body.walletId,
          startDate:
            body.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          endDate: body.endDate || new Date().toISOString(),
          format: body.format,
        },
      };

      // Publish with publisher confirm
      await QueueManager.publishWithConfirm(
        EXCHANGES.PAYRAIL_DIRECT,
        ROUTING_KEYS.STATEMENT,
        statementMessage,
        { correlationId, jobId },
      );

      const response: ApiResponse = {
        success: true,
        message: 'Statement generation job queued successfully',
        data: {
          jobId,
          status: 'QUEUED',
          walletId: body.walletId,
        },
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(202).json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return next(new BadRequestError('Validation error', err.errors));
      }
      next(err);
    }
  },
);

/**
 * GET /api/v1/notifications/statement-jobs/:jobId
 * Retrieves status of a specific statement generation job
 */
notificationsRouter.get(
  '/statement-jobs/:jobId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError();

      const job = await ProcessedJobModel.findOne({
        jobId: req.params.jobId,
        jobType: 'STATEMENT',
      });

      if (!job) {
        res.status(200).json({
          success: true,
          data: {
            jobId: req.params.jobId,
            status: 'PENDING_OR_QUEUED',
          },
        });
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: job,
        meta: {
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  },
);
