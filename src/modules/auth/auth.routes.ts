import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

export const authRouter = Router();

authRouter.get('/', (_req, res) => {
  res.status(200).json({
    module: 'auth',
    status: 'active',
    endpoints: ['POST /register', 'POST /login', 'GET /me', 'POST /logout'],
  });
});

// Public routes
authRouter.post('/register', AuthController.register);
authRouter.post('/login', AuthController.login);

// Protected routes (require valid, non-revoked Bearer token)
authRouter.get('/me', authenticate, AuthController.getProfile);
authRouter.post('/logout', authenticate, AuthController.logout);
