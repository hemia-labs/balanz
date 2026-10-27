import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  Organization,
  OrganizationStatus,
} from './entities/organization.entity';

export interface CreateOrganizationInput {
  name: string;
  legalName?: string;
  slug: string;
  billingEmail?: string;
  timezone: string;
  ownerUserId: string;
}

@Injectable()
export class OrganizationsService {
  createForRegistration(
    manager: EntityManager,
    input: CreateOrganizationInput,
  ): Promise<Organization> {
    const repository = manager.getRepository(Organization);
    return repository.save(
      repository.create({ ...input, status: OrganizationStatus.ACTIVE }),
    );
  }
}
