import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  Membership,
  MembershipRole,
  MembershipStatus,
} from './entities/membership.entity';

@Injectable()
export class MembershipsService {
  createOwner(
    manager: EntityManager,
    organizationId: string,
    userId: string,
  ): Promise<Membership> {
    const repository = manager.getRepository(Membership);
    return repository.save(
      repository.create({
        organizationId,
        userId,
        role: MembershipRole.OWNER,
        status: MembershipStatus.PENDING,
        mfaCompletedAt: null,
      }),
    );
  }
}
