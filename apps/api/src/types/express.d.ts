import { AuthenticatedUser } from '../common/auth/authenticated-user';

// Augmenta Express Request para exponer el usuario autenticado que setea JwtAuthGuard.
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
