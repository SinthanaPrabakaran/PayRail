import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';

export interface TokenPayload {
  sub: string; // user ID
  email: string; // user normalized email
  role: string; // access control role
  jti: string; // unique token ID for revocation checks
  iss: string;
  aud: string;
  iat?: number;
  exp?: number;
}

export function generateAccessToken(user: { id: string; email: string; role?: string }): {
  token: string;
  tokenId: string;
  expiresIn: string;
} {
  const tokenId = uuidv4();
  const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    role: user.role || 'user',
    jti: tokenId,
    iss: env.JWT_ISSUER,
    aud: env.JWT_AUDIENCE,
  };

  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });

  return { token, tokenId, expiresIn: env.JWT_EXPIRES_IN };
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  }) as TokenPayload;
}
