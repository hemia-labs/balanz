import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { UsersController } from '../src/modules/users/users.controller';

describe('UsersController read authorization', () => {
  const reflector = new Reflector();
  const audit = { recordDirect: jest.fn().mockResolvedValue({}) };

  function context(handler: (...args: never[]) => unknown): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => UsersController,
      switchToHttp: () => ({
        getRequest: () => ({
          tenantContext: {
            organizationId: '80dedccb-124f-4524-9b36-ce637b193113',
            userId: '4e7d3844-0677-4b5c-b58b-e44fe39c54a1',
            membershipId: 'efb56006-c953-4d69-8a2c-4aacd82de02d',
            permissions: [],
          },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it.each([
    ['GET /users', UsersController.prototype.findAll],
    ['GET /users/:id', UsersController.prototype.findOne],
  ])(
    'rejects a collaborator without team.view on %s',
    async (_name, handler) => {
      const guard = new PermissionsGuard(reflector, audit as never);

      await expect(guard.canActivate(context(handler))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );
});
