import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  CurrentSession,
  CurrentTenant,
} from '../../common/decorators/current-session.decorator';
import { SessionGuard } from '../../common/guards/session.guard';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import type { AuthSession } from '../sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { AuthService } from './auth.service';

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get('organizations')
  @UseGuards(SessionGuard)
  organizations(@CurrentSession() session: AuthSession) {
    return this.auth.listOrganizations(session.userId);
  }

  @Get('authorization')
  @UseGuards(SessionGuard, TenantAccessGuard)
  authorization(@CurrentTenant() context: SessionAuthorizationContext) {
    return {
      organizationId: context.organizationId,
      membershipId: context.membershipId,
      role: context.role,
      permissions: context.permissions,
      assignedAccountIds: context.assignedAccountIds,
      accountAccessMode: context.accountAccessMode,
      reauthenticationRequiredActions: [],
    };
  }
}
