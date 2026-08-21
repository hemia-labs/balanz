import { AuthenticatedUser } from '../common/auth/authenticated-user';
import type { AuthSession } from '../modules/sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../modules/sessions/session.types';

// Augmenta Express Request para exponer el usuario autenticado que setea JwtAuthGuard.
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      authSession?: AuthSession;
      tenantContext?: SessionAuthorizationContext;
    }
  }
}

export {};
