import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Membership, MembershipStatus } from './entities/membership.entity';
import { Role, RoleKey, RoleScope } from '../permissions/entities/role.entity';

@Injectable()
export class MembershipsService {
  async createOwner(
    manager: EntityManager,
    organizationId: string,
    userId: string,
  ): Promise<Membership> {
    const repository = manager.getRepository(Membership);
    const role = await manager.getRepository(Role).findOneByOrFail({
      key: RoleKey.OWNER,
      scope: RoleScope.ORGANIZATION,
    });
    return repository.save(
      repository.create({
        organizationId,
        userId,
        roleId: role.id,
        status: MembershipStatus.PENDING,
      }),
    );
  }
}
