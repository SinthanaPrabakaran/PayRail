import request from 'supertest';
import { createApp } from '../../src/app';
import { mongoManager } from '../../src/config/mongo';
import { redisManager } from '../../src/config/redis';
import { UserModel } from '../../src/modules/auth/user.model';
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env';

describe('Authentication Module (Phase 3)', () => {
  const app = createApp();

  const testUser = {
    email: 'johndoe@example.com',
    password: 'Password123!',
    firstName: 'John',
    lastName: 'Doe',
  };

  beforeAll(async () => {
    await mongoManager.connect(3, 1000);
    await redisManager.connect(3, 1000);
    await UserModel.deleteMany({ email: /example\.com$/ });
  });

  afterAll(async () => {
    await UserModel.deleteMany({ email: /example\.com$/ });
    await mongoManager.disconnect();
    await redisManager.disconnect();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should successfully register a new user and return a JWT access token', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(testUser);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data.user).toMatchObject({
        email: testUser.email,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        role: 'user',
      });
      // Ensure passwordHash is NEVER exposed
      expect(res.body.data.user).not.toHaveProperty('passwordHash');
      expect(res.body.data.user).not.toHaveProperty('password');
    });

    it('should normalize email to lowercase during registration', async () => {
      const upperEmailUser = {
        email: 'UPPERCASE_USER@EXAMPLE.COM',
        password: 'Password123!',
        firstName: 'Upper',
        lastName: 'Case',
      };

      const res = await request(app).post('/api/v1/auth/register').send(upperEmailUser);

      expect(res.status).toBe(201);
      expect(res.body.data.user.email).toBe('uppercase_user@example.com');
    });

    it('should reject registration if email is already taken (duplicate account)', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(testUser);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ConflictError');
    });

    it('should reject registration with malformed input (e.g. weak password)', async () => {
      const weakUser = {
        email: 'weak@example.com',
        password: 'weak', // missing uppercase, number, symbol, and min length
        firstName: 'Weak',
        lastName: 'User',
      };

      const res = await request(app).post('/api/v1/auth/register').send(weakUser);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ValidationError');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should successfully authenticate registered user with valid credentials', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data.user.email).toBe(testUser.email);
    });

    it('should authenticate case-insensitively with normalized email', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'JOHNDOE@EXAMPLE.COM',
        password: testUser.password,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(testUser.email);
    });

    it('should return generic 401 Unauthorized for invalid password', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: 'WrongPassword999!',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('should return generic 401 Unauthorized for non-existent user email', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'doesnotexist@example.com',
        password: 'Password123!',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Invalid email or password');
    });
  });

  describe('GET /api/v1/auth/me (Authenticated Profile Retrieval)', () => {
    let validToken: string;

    beforeAll(async () => {
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });
      validToken = loginRes.body.data.token;
    });

    it('should return profile for authenticated user derived strictly from JWT identity', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(testUser.email);
      expect(res.body.data.firstName).toBe(testUser.firstName);
      expect(res.body.data).not.toHaveProperty('passwordHash');
    });

    it('should prevent IDOR: ignore client-supplied userId in query string or body and only return own profile', async () => {
      // Register a second victim user
      const victimUser = await UserModel.create({
        email: 'victim@example.com',
        passwordHash: 'dummyhash',
        firstName: 'Victim',
        lastName: 'User',
      });

      // Attacker uses testUser's token, but attempts to inject victim's ID in query and body
      const res = await request(app)
        .get(`/api/v1/auth/me?userId=${victimUser.id}`)
        .send({ userId: victimUser.id })
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      // Response must strictly be the authenticated caller (testUser), NOT victimUser
      expect(res.body.data.email).toBe(testUser.email);
      expect(res.body.data.email).not.toBe(victimUser.email);
      expect(res.body.data.firstName).toBe(testUser.firstName);
      expect(res.body.data.id).not.toBe(victimUser.id);
    });

    it('should reject request without Authorization header', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UnauthorizedError');
    });

    it('should reject request with invalid/tampered token signature', async () => {
      const tamperedToken = validToken.slice(0, -6) + 'abcdef';

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject request with expired token', async () => {
      // Create an already-expired token with the same secret
      const expiredToken = jwt.sign(
        {
          sub: 'any-user-id',
          email: 'expired@example.com',
          role: 'user',
          jti: 'test-jti',
          iss: env.JWT_ISSUER,
          aud: env.JWT_AUDIENCE,
        },
        env.JWT_SECRET,
        { expiresIn: '-1s' },
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Token has expired');
    });
  });

  describe('POST /api/v1/auth/logout (Token Revocation)', () => {
    it('should successfully log out and revoke the token in Redis', async () => {
      // Login to get a fresh token
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });

      const freshToken = loginRes.body.data.token;

      // Access /me succeeds before logout
      const meBefore = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${freshToken}`);
      expect(meBefore.status).toBe(200);

      // Perform logout
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${freshToken}`);
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.message).toContain('Logged out successfully');

      // Subsequent request using same revoked token must fail with 401
      const meAfter = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${freshToken}`);
      expect(meAfter.status).toBe(401);
      expect(meAfter.body.error.message).toBe('Token has been revoked');
    });
  });
});
