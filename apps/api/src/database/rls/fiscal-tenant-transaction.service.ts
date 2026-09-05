import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WORKER_MEMBERSHIP_CONTEXT_ID =
  '00000000-0000-0000-0000-000000000000';

export interface FiscalTenantScope {
  organizationId: string;
  membershipId?: string | null;
}

export interface FiscalApiTenantScope extends FiscalTenantScope {
  membershipId: string;
}

export type FiscalDatabasePrincipal = 'api' | 'worker';

@Injectable()
export class FiscalTenantTransactionService {
  constructor(private readonly dataSource: DataSource) {}

  run<T>(
    scope: FiscalApiTenantScope,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.runAs('api', scope, work);
  }

  runAsWorker<T>(
    scope: FiscalTenantScope,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.runAs('worker', scope, work);
  }

  runWorkerMaintenance<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await this.applyPrincipal(manager, 'worker');
      return work(manager);
    });
  }

  private runAs<T>(
    principal: FiscalDatabasePrincipal,
    scope: FiscalTenantScope,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    this.assertScope(scope, principal);

    return this.dataSource.transaction(async (manager) => {
      await this.apply(manager, scope, principal);
      return work(manager);
    });
  }

  async apply(
    manager: EntityManager,
    scope: FiscalTenantScope,
    principal: FiscalDatabasePrincipal = 'api',
  ): Promise<void> {
    this.assertScope(scope, principal);
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error('Fiscal RLS context requires an active transaction');
    }

    await this.applyPrincipal(manager, principal);

    // set_config(..., true) is PostgreSQL's parameterized equivalent of
    // SET LOCAL. Both values disappear at transaction end and cannot leak
    // through a pooled connection.
    await manager.query(
      `SELECT
         set_config('app.organization_id', $1, true),
         set_config('app.membership_id', $2, true)`,
      [
        scope.organizationId,
        principal === 'worker'
          ? WORKER_MEMBERSHIP_CONTEXT_ID
          : scope.membershipId,
      ],
    );
  }

  private async applyPrincipal(
    manager: EntityManager,
    principal: FiscalDatabasePrincipal,
  ): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error('Fiscal database role requires an active transaction');
    }

    // The value is deliberately not interpolated. These are the only two
    // application roles and both are created NOBYPASSRLS by migration 061.
    if (principal === 'api') {
      await manager.query(`SET LOCAL ROLE balanz_api`);
      return;
    }
    await manager.query(`SET LOCAL ROLE balanz_worker`);
  }

  private assertScope(
    scope: FiscalTenantScope,
    principal: FiscalDatabasePrincipal,
  ): void {
    if (!UUID_PATTERN.test(scope.organizationId)) {
      throw new Error('A valid organization UUID is required for fiscal RLS');
    }
    if (
      principal === 'api' &&
      (!scope.membershipId ||
        scope.membershipId === WORKER_MEMBERSHIP_CONTEXT_ID ||
        !UUID_PATTERN.test(scope.membershipId))
    ) {
      throw new Error('A real membership UUID is required for API fiscal RLS');
    }
    if (
      principal === 'worker' &&
      scope.membershipId &&
      !UUID_PATTERN.test(scope.membershipId)
    ) {
      throw new Error('A valid membership UUID is required for fiscal RLS');
    }
  }
}
