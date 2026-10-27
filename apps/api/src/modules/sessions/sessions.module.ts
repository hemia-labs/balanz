import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { Membership } from '../memberships/entities/membership.entity';
import { AuthFactor } from '../auth/entities/auth-factor.entity';
import { AuthSession } from './entities/auth-session.entity';
import { AuthorizationService } from './authorization.service';
import { SessionsService } from './sessions.service';
import { RedisModule } from '../redis/redis.module';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { Permission } from '../permissions/entities/permission.entity';
import { RolePermission } from '../permissions/entities/role-permission.entity';
import { Role } from '../permissions/entities/role.entity';
import { MembershipPermission } from '../permissions/entities/membership-permission.entity';
import { AccountAssignment } from '../client-accounts/entities/account-assignment.entity';

@Module({
  imports: [
    RedisModule,
    TypeOrmModule.forFeature([
      AuthSession,
      User,
      Organization,
      Membership,
      AuthFactor,
      Permission,
      RolePermission,
      Role,
      MembershipPermission,
      AccountAssignment,
    ]),
  ],
  providers: [SessionsService, AuthorizationService, MfaGuard],
  exports: [SessionsService, AuthorizationService, MfaGuard],
})
export class SessionsModule {}
