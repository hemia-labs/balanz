import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';

function buildContext(
  user: unknown,
  request: Record<string, unknown> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, ...request }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let reflector: Reflector;
  let guard: PermissionsGuard;
  let audit: { recordDirect: jest.Mock };

  const withRequired = (required: string[] | undefined) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
  };

  beforeEach(() => {
    reflector = new Reflector();
    audit = { recordDirect: jest.fn().mockResolvedValue({}) };
    guard = new PermissionsGuard(reflector, audit as never);
  });

  it('permite el paso cuando no hay @Permissions', async () => {
    withRequired(undefined);
    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(
      true,
    );
  });

  it('permite con permiso exacto', async () => {
    withRequired(['users.view']);
    const ctx = buildContext({ sub: '1', permissions: ['users.view'] });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rechaza wildcard de recurso <resource>.*', async () => {
    withRequired(['users.delete']);
    const ctx = buildContext({ sub: '1', permissions: ['users.*'] });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rechaza el bypass superadmin *.*', async () => {
    withRequired(['users.edit']);
    const ctx = buildContext({ sub: '1', permissions: ['*.*'] });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('exige TODOS los permisos requeridos', async () => {
    withRequired(['users.view', 'users.export']);
    const ctx = buildContext({ sub: '1', permissions: ['users.view'] });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rechaza cuando el usuario no tiene el permiso', async () => {
    withRequired(['users.delete']);
    const ctx = buildContext({ sub: '1', permissions: ['users.view'] });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rechaza cuando no hay usuario autenticado', async () => {
    withRequired(['users.view']);
    await expect(
      guard.canActivate(buildContext(undefined)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no confunde recursos distintos con el mismo prefijo', async () => {
    withRequired(['users.view']);
    const ctx = buildContext({ sub: '1', permissions: ['user.*'] });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([
    'members.manage',
    'permissions.manage',
    'periods.close',
    'periods.reopen',
    'exports.generate',
  ])('exige MFA para %s', async (permission) => {
    withRequired([permission]);
    const ctx = buildContext(undefined, {
      authSession: { requiresMfa: true, mfaVerifiedAt: null },
      tenantContext: { permissions: [permission] },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('audita una denegación sensible con el contexto del tenant', async () => {
    withRequired(['permissions.manage']);
    const correlationId = '926bd242-1376-4829-8122-84a235db13bb';
    const ctx = buildContext(undefined, {
      correlationId,
      method: 'POST',
      authSession: { requiresMfa: true, mfaVerifiedAt: new Date() },
      tenantContext: {
        organizationId: '80dedccb-124f-4524-9b36-ce637b193113',
        userId: '4e7d3844-0677-4b5c-b58b-e44fe39c54a1',
        membershipId: 'efb56006-c953-4d69-8a2c-4aacd82de02d',
        permissions: [],
      },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(audit.recordDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authorization.denied',
        permissionKey: 'permissions.manage',
        decision: 'DENY',
        reason: 'INSUFFICIENT_PERMISSION',
        correlationId,
      }),
    );
  });
});
