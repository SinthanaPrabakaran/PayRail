import { hashPassword, verifyPassword } from '../../src/shared/password';

describe('Password Utility (Unit)', () => {
  it('should successfully hash a plain text password using Argon2id', async () => {
    const plain = 'StrongPass123!';
    const hash = await hashPassword(plain);

    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('should verify correct password successfully', async () => {
    const plain = 'MySecretP@ssw0rd';
    const hash = await hashPassword(plain);

    const isValid = await verifyPassword(plain, hash);
    expect(isValid).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const plain = 'CorrectPassword';
    const wrong = 'WrongPassword';
    const hash = await hashPassword(plain);

    const isValid = await verifyPassword(wrong, hash);
    expect(isValid).toBe(false);
  });

  it('should return false safely when hash is invalid/corrupt without throwing', async () => {
    const isValid = await verifyPassword('password', 'not-a-valid-argon2-hash');
    expect(isValid).toBe(false);
  });
});
