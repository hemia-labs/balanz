export function permissionMatches(granted: string, required: string): boolean {
  return granted === required;
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
