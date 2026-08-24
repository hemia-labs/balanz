import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Membership } from './entities/membership.entity';
import { MembershipsService } from './memberships.service';
import { Role } from '../permissions/entities/role.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Membership, Role])],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
