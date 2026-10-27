import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule as CommonAuthModule } from '../../common/auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { Membership } from '../memberships/entities/membership.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { RolePermission } from '../permissions/entities/role-permission.entity';
import { Role } from '../permissions/entities/role.entity';
import { SessionsModule } from '../sessions/sessions.module';
import { User } from '../users/entities/user.entity';
import { EmailVerificationToken } from '../auth/entities/email-verification-token.entity';
import { Invitation } from './entities/invitation.entity';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [
    CommonAuthModule,
    AuditModule,
    EmailModule,
    SessionsModule,
    TypeOrmModule.forFeature([
      Invitation,
      EmailVerificationToken,
      Membership,
      Organization,
      Permission,
      RolePermission,
      Role,
      User,
    ]),
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
