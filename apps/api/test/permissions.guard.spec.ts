import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';

function buildContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let reflector: Reflector;
  let guard: PermissionsGuard;

  const withRequired = (required: string[] | undefined) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  it('permite el paso cuando no hay @Permissions', () => {
    withRequired(undefined);
    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });

  it('permite con permiso exacto', () => {
    withRequired(['users.view']);
    const ctx = buildContext({ sub: '1', permissions: ['users.view'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('permite con wildcard de recurso <resource>.*', () => {
    withRequired(['users.delete']);
    const ctx = buildContext({ sub: '1', permissions: ['users.*'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('permite con superadmin *.*', () => {
    withRequired(['users.edit']);
    const ctx = buildContext({ sub: '1', permissions: ['*.*'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('exige TODOS los permisos requeridos', () => {
    withRequired(['users.view', 'users.export']);
    const ctx = buildContext({ sub: '1', permissions: ['users.view'] });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rechaza cuando el usuario no tiene el permiso', () => {
    withRequired(['users.delete']);
    const ctx = buildContext({ sub: '1', permissions: ['users.view'] });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rechaza cuando no hay usuario autenticado', () => {
    withRequired(['users.view']);
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('no confunde recursos distintos con el mismo prefijo', () => {
    withRequired(['users.view']);
    const ctx = buildContext({ sub: '1', permissions: ['user.*'] });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
