import { UserModel, IUserDocument } from './user.model.js';
import { RegisterInput, LoginInput } from './auth.schema.js';
import { hashPassword, verifyPassword } from '../../shared/password.js';
import { generateAccessToken } from '../../shared/token.js';
import { ConflictError, UnauthorizedError, NotFoundError } from '../../shared/errors.js';
import { TokenRevocationService } from './tokenRevocation.service.js';
import { logger } from '../../shared/logger.js';

export interface AuthResult {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    createdAt: Date;
  };
  token: string;
  expiresIn: string;
}

export class AuthService {
  /**
   * Registers a new user account with normalized email and Argon2id hash.
   */
  public static async register(input: RegisterInput): Promise<AuthResult> {
    const normalizedEmail = input.email.toLowerCase().trim();

    // Check duplicate account
    const existingUser = await UserModel.findOne({ email: normalizedEmail });
    if (existingUser) {
      throw new ConflictError('An account with this email address already exists');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await UserModel.create({
      email: normalizedEmail,
      passwordHash,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      role: 'user',
      isActive: true,
    });

    logger.info('User successfully registered', { userId: user.id, email: user.email });

    const { token, expiresIn } = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        createdAt: user.createdAt,
      },
      token,
      expiresIn,
    };
  }

  /**
   * Authenticates user credentials with generic error messages to prevent enumeration.
   */
  public static async login(input: LoginInput): Promise<AuthResult> {
    const normalizedEmail = input.email.toLowerCase().trim();

    // Must explicitly select passwordHash since it's hidden by default in schema
    const user = await UserModel.findOne({ email: normalizedEmail }).select('+passwordHash');

    if (!user || !user.isActive) {
      // Generic error message prevents username/email enumeration
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValidPassword = await verifyPassword(input.password, user.passwordHash);
    if (!isValidPassword) {
      throw new UnauthorizedError('Invalid email or password');
    }

    logger.info('User authenticated successfully', { userId: user.id });

    const { token, expiresIn } = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        createdAt: user.createdAt,
      },
      token,
      expiresIn,
    };
  }

  /**
   * Retrieves profile of authenticated user derived from token identity (never client param).
   */
  public static async getProfile(userId: string): Promise<IUserDocument> {
    const user = await UserModel.findById(userId);
    if (!user || !user.isActive) {
      throw new NotFoundError('User profile not found');
    }
    return user;
  }

  /**
   * Revokes the current access token.
   */
  public static async logout(tokenId: string): Promise<void> {
    await TokenRevocationService.revokeToken(tokenId);
  }
}
