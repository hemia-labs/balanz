import { AuthenticatedUser } from '../common/auth/authenticated-user';
import type { AuthSession } from '../modules/sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../modules/sessions/session.types';

// Augmenta Express Request para exponer el contexto autenticado que setea SessionGuard.
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
