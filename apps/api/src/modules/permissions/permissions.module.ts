import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Membership } from '../memberships/entities/membership.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { SessionsModule } from '../sessions/sessions.module';
import { User } from '../users/entities/user.entity';
import { MembershipPermission } from './entities/membership-permission.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { Role } from './entities/role.entity';
import { PermissionAdministrationController } from './permission-administration.controller';
import { PermissionAdministrationService } from './permission-administration.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Membership,
      Organization,
      User,
      Role,
      Permission,
      RolePermission,
      MembershipPermission,
    ]),
    SessionsModule,
    AuditModule,
  ],
  controllers: [PermissionAdministrationController],
  providers: [PermissionAdministrationService],
})
export class PermissionsModule {}
