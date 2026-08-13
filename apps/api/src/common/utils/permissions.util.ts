/**
 * Matching de permisos con wildcards.
 *
 * Un permiso concedido (`granted`) cubre el requerido (`required`) si:
 *  - `*.*`               → superadmin, cubre cualquier permiso.
 *  - `<resource>.*`      → cubre cualquier acción sobre ese recurso.
 *  - `<resource>.<action>` exacto.
 */
export function permissionMatches(granted: string, required: string): boolean {
  if (granted === '*.*') return true;
  if (granted === required) return true;

  const [grantedResource, grantedAction] = granted.split('.');
  const [requiredResource] = required.split('.');

  return grantedAction === '*' && grantedResource === requiredResource;
}

/** El usuario satisface el permiso requerido si alguno de los suyos lo cubre. */
export function hasPermission(
  userPermissions: string[],
  required: string,
): boolean {
  return userPermissions.some((granted) =>
    permissionMatches(granted, required),
  );
}

/** Debe satisfacer TODOS los permisos requeridos. */
export function hasAllPermissions(
  userPermissions: string[],
  required: string[],
): boolean {
  return required.every((perm) => hasPermission(userPermissions, perm));
}
