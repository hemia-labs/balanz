import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import {
  AccountAssignment,
  AccountAssignmentStatus,
} from './entities/account-assignment.entity';
import {
  ClientAccount,
  ClientAccountStatus,
} from './entities/client-account.entity';
import { domainError } from './client-domain.errors';

@Injectable()
export class ClientAccountScopeService {
  constructor(
    @InjectRepository(ClientAccount)
    private readonly accounts: Repository<ClientAccount>,
    @InjectRepository(AccountAssignment)
    private readonly assignments: Repository<AccountAssignment>,
  ) {}

  async requireAccessibleAccount(
    clientAccountId: string,
    context: SessionAuthorizationContext,
    allowArchived = false,
  ): Promise<ClientAccount> {
    if (!context.organizationId || !context.membershipId) {
      throw domainError(
        HttpStatus.NOT_FOUND,
        'CLIENT_ACCOUNT_NOT_FOUND',
        'Client account not found',
      );
    }
    const account = await this.accounts.findOne({
      where: {
        id: clientAccountId,
        organizationId: context.organizationId,
      },
    });
    if (
      !account ||
      (account.status === ClientAccountStatus.ARCHIVED && !allowArchived)
    ) {
      throw domainError(
        HttpStatus.NOT_FOUND,
        'CLIENT_ACCOUNT_NOT_FOUND',
        'Client account not found',
      );
    }
    if (context.accountAccessMode === 'assigned') {
      const assigned = await this.assignments.existsBy({
        organizationId: context.organizationId,
        clientAccountId,
        membershipId: context.membershipId,
        status: AccountAssignmentStatus.ACTIVE,
      });
      if (!assigned) {
        throw domainError(
          HttpStatus.NOT_FOUND,
          'CLIENT_ACCOUNT_NOT_FOUND',
          'Client account not found',
        );
      }
    }
    return account;
  }

  async requireAccessibleAccountWithManager(
    manager: EntityManager,
    clientAccountId: string,
    context: SessionAuthorizationContext,
    allowArchived = false,
    lock = false,
  ): Promise<ClientAccount> {
    if (!context.organizationId || !context.membershipId) {
      throw this.notFound();
    }
    const account = await manager.getRepository(ClientAccount).findOne({
      where: {
        id: clientAccountId,
        organizationId: context.organizationId,
      },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (
      !account ||
      (account.status === ClientAccountStatus.ARCHIVED && !allowArchived)
    ) {
      throw this.notFound();
    }
    if (context.accountAccessMode === 'assigned') {
      const assigned = await manager.getRepository(AccountAssignment).existsBy({
        organizationId: context.organizationId,
        clientAccountId,
        membershipId: context.membershipId,
        status: AccountAssignmentStatus.ACTIVE,
      });
      if (!assigned) throw this.notFound();
    }
    return account;
  }

  canIncludeArchived(context: SessionAuthorizationContext): boolean {
    return context.accountAccessMode === 'tenant';
  }

  private notFound() {
    return domainError(
      HttpStatus.NOT_FOUND,
      'CLIENT_ACCOUNT_NOT_FOUND',
      'Client account not found',
    );
  }
}
