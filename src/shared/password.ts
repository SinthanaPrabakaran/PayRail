import argon2 from 'argon2';

/**
 * Password hashing utility using Argon2id
 * Argon2id combines Argon2d and Argon2i to provide resistance against both
 * side-channel cache timing attacks and GPU-based brute force cracking.
 */
export async function hashPassword(plainText: string): Promise<string> {
  return argon2.hash(plainText, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16, // 64 MB
    timeCost: 3, // 3 iterations
    parallelism: 1,
  });
}

export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainText);
  } catch {
    return false;
  }
}
