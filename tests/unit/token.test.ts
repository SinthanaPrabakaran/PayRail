import { generateAccessToken, verifyAccessToken } from '../../src/shared/token';
import { env } from '../../src/config/env';

describe('Token Utility (Unit)', () => {
  const mockUser = {
    id: '507f1f77bcf86cd799439011',
    email: 'test@example.com',
    role: 'user',
  };

  it('should generate a valid access token with default role and expected claims', () => {
    const result = generateAccessToken(mockUser);

    expect(result.token).toBeDefined();
    expect(result.tokenId).toBeDefined();
    expect(result.expiresIn).toBe(env.JWT_EXPIRES_IN);

    const decoded = verifyAccessToken(result.token);
    expect(decoded.sub).toBe(mockUser.id);
    expect(decoded.email).toBe(mockUser.email);
    expect(decoded.role).toBe(mockUser.role);
    expect(decoded.jti).toBe(result.tokenId);
    expect(decoded.iss).toBe(env.JWT_ISSUER);
    expect(decoded.aud).toBe(env.JWT_AUDIENCE);
  });

  it('should default role to "user" if omitted', () => {
    const result = generateAccessToken({ id: '123', email: 'norole@example.com' });
    const decoded = verifyAccessToken(result.token);
    expect(decoded.role).toBe('user');
  });

  it('should throw error when token signature is invalid', () => {
    const result = generateAccessToken(mockUser);
    const tamperedToken = result.token.slice(0, -5) + 'abcde';

    expect(() => verifyAccessToken(tamperedToken)).toThrow();
  });

  it('should throw error when verifying random malformed string', () => {
    expect(() => verifyAccessToken('totally-invalid-token')).toThrow();
  });
});
