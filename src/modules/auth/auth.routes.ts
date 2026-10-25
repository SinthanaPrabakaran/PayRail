import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { rateLimiter } from '../../middleware/rateLimiter.middleware.js';

export const authRouter = Router();

authRouter.get('/', (_req, res) => {
  res.status(200).json({
    module: 'auth',
    status: 'active',
    endpoints: ['POST /register', 'POST /login', 'GET /me', 'POST /logout'],
  });
});

// Per-IP rate limiting for unauthenticated auth endpoints: 20 requests per 60 seconds
const authLimiter = rateLimiter({
  windowSeconds: 60,
  maxRequests: 20,
  keyPrefix: 'auth_public',
  isPerUser: false,
});

// Public routes
authRouter.post('/register', authLimiter, AuthController.register);
authRouter.post('/login', authLimiter, AuthController.login);

// Protected routes (require valid, non-revoked Bearer token)
authRouter.get('/me', authenticate, AuthController.getProfile);
authRouter.post('/logout', authenticate, AuthController.logout);
