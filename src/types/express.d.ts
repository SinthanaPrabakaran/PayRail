export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;
  tokenId: string;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthenticatedUser;
    }
  }
}

export {};
