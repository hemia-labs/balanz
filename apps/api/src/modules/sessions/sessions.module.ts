import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { Membership } from '../memberships/entities/membership.entity';
import { AuthSession } from './entities/auth-session.entity';
import { AuthorizationService } from './authorization.service';
import { SessionsService } from './sessions.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    RedisModule,
    TypeOrmModule.forFeature([AuthSession, User, Organization, Membership]),
  ],
  providers: [SessionsService, AuthorizationService],
  exports: [SessionsService, AuthorizationService],
})
export class SessionsModule {}
