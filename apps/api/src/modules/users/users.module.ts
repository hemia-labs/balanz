import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Membership } from '../memberships/entities/membership.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SessionsModule } from '../sessions/sessions.module';
import { Role } from '../permissions/entities/role.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Membership, Role]), SessionsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
