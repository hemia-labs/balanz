import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declara los permisos requeridos para un endpoint.
 * Formato: `<resource>.<action>` (p.ej. `users.view`, `users.create`).
 * El usuario debe satisfacer TODOS los permisos listados (ver PermissionsGuard).
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
