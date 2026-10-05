import assert from 'node:assert/strict';
import {
  resolveMonthlyClaim,
  type MonthlyReconciliationClaim,
} from '../../src/modules/cfdi/workers/monthly-reconciliation.service';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import {
  getDatabaseOptions,
  withRuntimeDatabaseRole,
} from '../../src/config/database.config';
import { seedDatabase } from '../../src/database/seeds/seed-database';
import { FiscalTenantTransactionService } from '../../src/database/rls/fiscal-tenant-transaction.service';
import { MonthlyService } from '../../src/modules/client-accounts/monthly.service';
import { ClientAccountScopeService } from '../../src/modules/client-accounts/client-account-scope.service';
import { AuthorizationService } from '../../src/modules/sessions/authorization.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { Organization } from '../../src/modules/organizations/entities/organization.entity';
import { Membership } from '../../src/modules/memberships/entities/membership.entity';
import { RolePermission } from '../../src/modules/permissions/entities/role-permission.entity';
import { MembershipPermission } from '../../src/modules/permissions/entities/membership-permission.entity';
import { AuthFactor } from '../../src/modules/auth/entities/auth-factor.entity';
import { ClientAccount } from '../../src/modules/client-accounts/entities/client-account.entity';
import { AccountAssignment } from '../../src/modules/client-accounts/entities/account-assignment.entity';
import { DEFAULT_DECISION } from '../../src/modules/client-accounts/monthly.contract';
import { MonthlyQueryDto } from '../../src/modules/client-accounts/monthly.dtos';

describe('Phase 5 isolated real PostgreSQL', () => {
  it('preserves editor fencing, snapshots and runtime RLS', async () => {
    if (process.env.RUN_MONTHLY_INTEGRATION !== 'true')
      throw new Error(
        'RUN_MONTHLY_INTEGRATION=true required; only test_* databases.',
      );
    const env = JSON.parse(
      execFileSync(
        'docker',
        [
          'inspect',
          '--format',
          '{{json .Config.Env}}',
          'balanz-cfdi-phase0-postgres-1',
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 15000 },
      ),
    ) as string[];
    const settings = Object.fromEntries(
      env.map((x) => {
        const i = x.indexOf('=');
        return [x.slice(0, i), x.slice(i + 1)];
      }),
    );
    const suffix = randomBytes(6).toString('hex'),
      database = 'test_monthly_' + suffix,
      login = 'monthly_api_' + suffix,
      password = randomBytes(24).toString('hex');
    const options = getDatabaseOptions({
      host: '127.0.0.1',
      port: 55432,
      username: settings.POSTGRES_USER,
      password: settings.POSTGRES_PASSWORD,
      name: settings.POSTGRES_DB,
      logging: false,
      connectionTimeoutMs: 3000,
    });
    if (options.type !== 'postgres') throw new Error('PostgreSQL required');
    const admin = new DataSource({ ...options, entities: [], migrations: [] });
    let db: DataSource | undefined, api: DataSource | undefined;
    let pendingImport: QueryRunner | undefined;
    let worker: DataSource | undefined;
    const workerLogin = 'monthly_worker_' + suffix;
    try {
      await admin.initialize();
      await admin.query('CREATE DATABASE "' + database + '"');
      db = new DataSource({ ...options, database });
      await db.initialize();
      await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await db.runMigrations({ transaction: 'each' });
      await seedDatabase(db);
      await admin.query(
        `CREATE ROLE "${login}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
      );
      await admin.query('GRANT balanz_api TO "' + login + '"');
      api = new DataSource(
        withRuntimeDatabaseRole(
          { ...options, database, username: login, password, migrations: [] },
          'balanz_api',
        ),
      );
      await api.initialize();
      await admin.query(
        `CREATE ROLE "${workerLogin}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
      );
      await admin.query('GRANT balanz_worker TO "' + workerLogin + '"');
      worker = new DataSource(
        withRuntimeDatabaseRole(
          {
            ...options,
            database,
            username: workerLogin,
            password,
            migrations: [],
          },
          'balanz_worker',
        ),
      );
      await worker.initialize();
      const user = randomUUID(),
        org = randomUUID(),
        member = randomUUID(),
        account = randomUUID(),
        entity = randomUUID(),
        session = randomUUID(),
        year = randomUUID(),
        period = randomUUID();
      const [role] = await db.query<{ id: string }[]>(
        "SELECT id FROM roles WHERE key='admin'",
      );
      await db.query(
        `INSERT INTO users(id,first_name,last_name,email,status,password_hash,email_verified_at) VALUES($1,'Persona','Uno',$2,'active','no-login',clock_timestamp())`,
        [user, 'monthly-' + suffix + '@example.invalid'],
      );
      await db.query(
        `INSERT INTO organizations(id,name,slug,owner_user_id,status,timezone) VALUES($1,'Monthly QA',$2,$3,'active','America/Mexico_City')`,
        [org, 'monthly-' + suffix, user],
      );
      await db.query(
        `INSERT INTO memberships(id,organization_id,user_id,role_id,status,joined_at) VALUES($1,$2,$3,$4,'active',clock_timestamp())`,
        [member, org, user, role.id],
      );
      await db.query(
        `INSERT INTO client_accounts(id,organization_id,name,status) VALUES($1,$2,'Monthly QA','active')`,
        [account, org],
      );
      await db.query(
        `INSERT INTO legal_entities(id,organization_id,client_account_id,rfc,legal_name,status) VALUES($1,$2,$3,'AAA010101AAA','QA','active')`,
        [entity, org, account],
      );
      await db.query(
        `INSERT INTO auth_factors(id,user_id,status,secret_encrypted,verified_at) VALUES($1,$2,'active','synthetic-unused',clock_timestamp())`,
        [randomUUID(), user],
      );
      await db.query(
        `INSERT INTO auth_sessions(id,user_id,organization_id,membership_id,session_token_hash,status,requires_mfa,mfa_verified_at,reauthenticated_at,expires_at,last_activity_at) VALUES($1,$2,$3,$4,$5,'active',true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
        [session, user, org, member, randomBytes(32).toString('hex')],
      );
      await db.query(
        `INSERT INTO fiscal_years(id,organization_id,client_account_id,legal_entity_id,year,status,version) VALUES($1,$2,$3,$4,2026,'active',1)`,
        [year, org, account, entity],
      );
      await db.query(
        `INSERT INTO periods(id,organization_id,client_account_id,legal_entity_id,fiscal_year_id,month,status,lock_version) VALUES($1,$2,$3,$4,$5,1,'not_started',0)`,
        [period, org, account, entity, year],
      );
      const authorization = new AuthorizationService(
        api.getRepository(User),
        api.getRepository(Organization),
        api.getRepository(Membership),
        api.getRepository(RolePermission),
        api.getRepository(AuthFactor),
        api,
        api.getRepository(MembershipPermission),
        api.getRepository(AccountAssignment),
      );
      const transactions = new FiscalTenantTransactionService(api);
      const service = new MonthlyService(
        api,
        transactions,
        authorization,
        new ClientAccountScopeService(
          api.getRepository(ClientAccount),
          api.getRepository(AccountAssignment),
        ),
      );
      const { context: t } = await authorization.revalidateSession(session);
      const token = randomBytes(32).toString('hex');
      const overview = await service.overview(t, period);
      expect(overview.counts.documents).toBe(0);
      expect(
        (await db.query<unknown[]>('SELECT * FROM monthly_workspaces')).length,
      ).toBe(0);
      const lease = await service.acquire(t, period, { instanceToken: token });
      expect(lease.version).toBe(0);
      await expect(
        service.acquire(t, period, {
          instanceToken: randomBytes(32).toString('hex'),
        }),
      ).rejects.toThrow();
      expect(
        (
          await service.renew(t, period, {
            instanceToken: token,
            expectedVersion: 0,
          })
        ).version,
      ).toBe(0);
      let version = 0;
      for (const key of ['relationships_reviewed', 'scope_confirmed']) {
        const result = await service.confirmChecklist(
          t,
          period,
          {
            instanceToken: token,
            expectedVersion: version,
            key,
            confirmed: true,
            itemVersion: 0,
            reason: 'Revisión sintética de alcance vacío',
          },
          randomUUID(),
        );
        version = Number(result.version);
      }
      const uncertain = randomUUID();
      await db.query(
        `INSERT INTO sat_download_jobs(id,organization_id,client_account_id,legal_entity_id,user_id,membership_id,idempotency_key,request_fingerprint,direction,content_type,document_type,document_status,date_from,date_to,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'issued','xml','I','all','2026-01-01','2026-01-31T23:59:59','external_submission_unknown')`,
        [
          uncertain,
          org,
          account,
          entity,
          user,
          member,
          randomUUID(),
          'f'.repeat(64),
        ],
      );
      expect((await service.overview(t, period)).sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: uncertain,
            pending: true,
            status: 'external_submission_unknown',
          }),
        ]),
      );
      await expect(
        service.prepareClose(t, period, {
          instanceToken: token,
          expectedVersion: version,
        }),
      ).rejects.toThrow();
      await db.query(
        "UPDATE auth_sessions SET reauthenticated_at=clock_timestamp()-interval '16 minutes' WHERE id=$1",
        [session],
      );
      await expect(
        service.prepareClose(t, period, {
          instanceToken: token,
          expectedVersion: version,
          sourceExceptionReason: 'Sólo revisión interna sintética',
        }),
      ).rejects.toThrow();
      await db.query(
        'UPDATE auth_sessions SET reauthenticated_at=clock_timestamp() WHERE id=$1',
        [session],
      );
      const scoped = await service.prepareClose(t, period, {
        instanceToken: token,
        expectedVersion: version,
        sourceExceptionReason: 'Sólo revisión interna sintética',
      });
      version = scoped.version;
      const scopeClose = await service.close(
        t,
        period,
        {
          instanceToken: token,
          expectedVersion: version,
          sourceExceptionReason: 'Sólo revisión interna sintética',
        },
        randomUUID(),
      );
      version = Number(scopeClose.version);
      expect(
        (
          await db.query<{ status: string }[]>(
            'SELECT status FROM sat_download_jobs WHERE id=$1',
            [uncertain],
          )
        )[0].status,
      ).toBe('external_submission_unknown');
      expect(
        (
          await db.query<
            {
              snapshot: { sources: { id: string; pending: boolean }[] };
              source_exception_reason: string;
            }[]
          >(
            'SELECT snapshot,source_exception_reason FROM monthly_closes WHERE period_id=$1',
            [period],
          )
        )[0],
      ).toEqual(
        expect.objectContaining({
          source_exception_reason: 'Sólo revisión interna sintética',
          snapshot: expect.objectContaining({
            sources: expect.arrayContaining([
              expect.objectContaining({ id: uncertain, pending: true }),
            ]) as unknown,
          }) as unknown,
        }),
      );
      const resumedScope = await service.reopen(
        t,
        period,
        {
          instanceToken: token,
          expectedVersion: version,
          reason: 'Continuar el recorrido sintético',
        },
        randomUUID(),
      );
      version = Number(resumedScope.version);
      // A separate source has an explicit terminal cancellation; this does not reconcile the unknown submission.
      await db.query(
        "UPDATE sat_download_jobs SET status='cancelled',terminal_at=clock_timestamp() WHERE id=$1",
        [uncertain],
      );
      const prepared = await service.prepareClose(t, period, {
        instanceToken: token,
        expectedVersion: version,
      });
      expect(prepared.participations).toBe(0);
      const closeKey = randomUUID();
      const closed = await service.close(
        t,
        period,
        { instanceToken: token, expectedVersion: prepared.version },
        closeKey,
      );
      expect(closed.status).toBe('closed');
      expect(
        await service.close(
          t,
          period,
          { instanceToken: token, expectedVersion: prepared.version },
          closeKey,
        ),
      ).toEqual(closed);
      await expect(
        transactions.run({ organizationId: org, membershipId: member }, (m) =>
          m.query('DELETE FROM monthly_closes WHERE period_id=$1', [period]),
        ),
      ).rejects.toThrow();
      const reopened = await service.reopen(
        t,
        period,
        {
          instanceToken: token,
          expectedVersion: Number(closed.version),
          reason: 'Agregar comprobantes de prueba',
        },
        randomUUID(),
      );
      expect(reopened.status).toBe('reopened');
      expect(
        (await db.query<unknown[]>('SELECT * FROM monthly_closes')).length,
      ).toBe(2);
      await expect(
        transactions.run(
          { organizationId: randomUUID(), membershipId: member },
          (m) => m.query('SELECT * FROM monthly_closes'),
        ),
      ).resolves.toEqual([]);

      const month2 = randomUUID();
      await db.query(
        `INSERT INTO periods(id,organization_id,client_account_id,legal_entity_id,fiscal_year_id,month,status,lock_version) VALUES($1,$2,$3,$4,$5,2,'not_started',0)`,
        [month2, org, account, entity, year],
      );
      const addDocument = async (
        type: string,
        total: string,
        currency = 'MXN',
        target = period,
        executor: Pick<DataSource, 'query'> = db!,
      ) => {
        const object = randomUUID(),
          cfdi = randomUUID(),
          participation = randomUUID();
        await executor.query(
          `INSERT INTO stored_objects(id,organization_id,client_account_id,legal_entity_id,kind,storage_provider,storage_container,object_key,size_bytes,sha256,encryption_class,lifecycle_state,malware_scan_status,uploaded_at,malware_scanned_at,available_at) VALUES($1,$2,$3,$4,'manual_xml','local','qa',$5,128,$6,'fiscal','available','clean',clock_timestamp(),clock_timestamp(),clock_timestamp())`,
          [object, org, account, entity, 'qa/' + object, 'a'.repeat(64)],
        );
        await executor.query(
          `INSERT INTO cfdis(id,organization_id,client_account_id,legal_entity_id,source_object_id,normalized_uuid,cfdi_version,schema_version,parser_version,document_type,issued_at,certified_at,issuer_rfc,receiver_rfc,currency,subtotal,total) VALUES($1,$2,$3,$4,$5,$6,'4.0','test-schema','test-parser',$7,'2026-01-31T23:00:00Z','2026-01-31T23:01:00Z','AAA010101AAA','BBB010101BBB',$8,$9,$9)`,
          [
            cfdi,
            org,
            account,
            entity,
            object,
            randomUUID(),
            type,
            currency,
            total,
          ],
        );
        await executor.query(
          `INSERT INTO period_cfdis(id,organization_id,client_account_id,legal_entity_id,cfdi_id,period_id,participation_type,policy_version,timezone,source_date,source_ordinal,origin) VALUES($1,$2,$3,$4,$5,$6,$7,'cfdi-period-participation/1.0.0','America/Mexico_City','2026-01-31T23:00:00Z',1,'automatic')`,
          [
            participation,
            org,
            account,
            entity,
            cfdi,
            target,
            type === 'P'
              ? 'payment'
              : type === 'N'
                ? 'payroll'
                : 'document_issue',
          ],
        );
        return { cfdi, participation };
      };
      const income = await addDocument('I', '9007199254740993.123456'),
        expense = await addDocument('E', '40'),
        dollars = await addDocument('I', '12.500000', 'USD'),
        payment = await addDocument('P', '0'),
        transfer = await addDocument('T', '50');
      const payment2 = randomUUID();
      await db.query(
        `INSERT INTO period_cfdis(id,organization_id,client_account_id,legal_entity_id,cfdi_id,period_id,participation_type,policy_version,timezone,source_date,source_ordinal,origin) VALUES($1,$2,$3,$4,$5,$6,'payment','cfdi-period-participation/1.0.0','America/Mexico_City','2026-02-05T18:00:00Z',2,'automatic')`,
        [payment2, org, account, entity, payment.cfdi, month2],
      );
      const overviewWithDocs = await service.overview(t, period);
      expect(overviewWithDocs.counts.documents).toBe(5);
      expect(overviewWithDocs.amounts).toEqual(
        expect.arrayContaining([
          {
            currency: 'MXN',
            documentType: 'I',
            direction: 'issued',
            total: '9007199254740993.123456',
          },
          {
            currency: 'MXN',
            documentType: 'E',
            direction: 'issued',
            total: '40.000000',
          },
          {
            currency: 'USD',
            documentType: 'I',
            direction: 'issued',
            total: '12.500000',
          },
        ]),
      );
      expect(overviewWithDocs.amounts).toHaveLength(3);
      const q = new MonthlyQueryDto();
      q.limit = 2;
      expect((await service.list(t, period, q)).items).toHaveLength(2);
      q.page = 2;
      expect((await service.list(t, period, q)).meta.total).toBe(5);
      let workspaceVersion = Number(reopened.version);
      const decisionKey = randomUUID();
      const firstInput = {
        ...DEFAULT_DECISION,
        reviewStatus: 'reviewed' as const,
        instanceToken: token,
        expectedVersion: workspaceVersion,
        decisionVersion: 0,
      };
      const first = await service.decision(
        t,
        period,
        income.participation,
        firstInput,
        decisionKey,
      );
      workspaceVersion = Number(first.version);
      expect(
        await service.decision(
          t,
          period,
          income.participation,
          firstInput,
          decisionKey,
        ),
      ).toEqual(first);
      await expect(
        service.decision(
          t,
          period,
          income.participation,
          { ...firstInput, expectedVersion: workspaceVersion },
          randomUUID(),
        ),
      ).rejects.toThrow();
      const batch = {
        instanceToken: token,
        expectedVersion: workspaceVersion,
        selection: [
          { id: income.participation, version: 0 },
          { id: expense.participation, version: 0 },
          { id: payment.participation, version: 0 },
        ],
        action: 'review' as const,
      };
      const preview = await service.bulk(t, period, batch, randomUUID(), true);
      expect(preview.failed).toBe(1);
      const bulkKey = randomUUID();
      const executed = await service.bulk(
        t,
        period,
        { ...batch, previewId: String(preview.previewId) },
        bulkKey,
        false,
      );
      expect(executed.applied).toBe(2);
      expect(executed.failed).toBe(1);
      workspaceVersion = Number(executed.version);
      expect(
        await service.bulk(
          t,
          period,
          { ...batch, previewId: String(preview.previewId) },
          bulkKey,
          false,
        ),
      ).toEqual(executed);
      expect(
        (await service.list(t, month2, new MonthlyQueryDto())).items[0]
          .reviewStatus,
      ).toBe('pending');
      await expect(
        service.decision(
          t,
          period,
          transfer.participation,
          {
            ...DEFAULT_DECISION,
            instanceToken: token,
            expectedVersion: workspaceVersion,
            decisionVersion: 0,
            inclusion: 'excluded',
            exclusionReason: null,
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
      const category = await service.category(t, period, undefined, {
        label: 'Revisión especial',
        archived: false,
        expectedVersion: 0,
      });
      const classified = await service.decision(
        t,
        period,
        dollars.participation,
        {
          ...DEFAULT_DECISION,
          instanceToken: token,
          expectedVersion: workspaceVersion,
          decisionVersion: 0,
          reviewStatus: 'reviewed',
          categoryId: category.id,
        },
        randomUUID(),
      );
      workspaceVersion = Number(classified.version);
      await service.category(t, period, category.id, {
        label: 'Etiqueta nueva',
        archived: true,
        expectedVersion: 1,
      });
      expect(
        (await service.list(t, period, new MonthlyQueryDto())).items.find(
          (x) => x.id === dollars.participation,
        )?.categoryLabel,
      ).toBe('Revisión especial');
      const transferDecision = await service.decision(
        t,
        period,
        transfer.participation,
        {
          ...DEFAULT_DECISION,
          instanceToken: token,
          expectedVersion: workspaceVersion,
          decisionVersion: 0,
          reviewStatus: 'reviewed',
        },
        randomUUID(),
      );
      workspaceVersion = Number(transferDecision.version);
      pendingImport = db.createQueryRunner();
      await pendingImport.connect();
      await pendingImport.startTransaction();
      await pendingImport.query('SELECT transaction_timestamp()');
      const ready2 = await service.prepareClose(t, period, {
        instanceToken: token,
        expectedVersion: workspaceVersion,
      });
      const close2 = await service.close(
        t,
        period,
        { instanceToken: token, expectedVersion: ready2.version },
        randomUUID(),
      );
      expect(close2.closeVersion).toBe(3);
      const arrival = await addDocument(
        'I',
        '9',
        'MXN',
        period,
        pendingImport.manager,
      );
      await pendingImport.commitTransaction();
      await pendingImport.release();
      pendingImport = undefined;
      expect((await service.overview(t, period)).period.status).toBe(
        'changes_detected',
      );
      expect((await service.news(t, period)).added.map((x) => x.id)).toContain(
        arrival.participation,
      );
      const pagedClose = await service.closes(t, period, 3, 2, 2);
      expect(
        'snapshot' in pagedClose && pagedClose.snapshot?.participations,
      ).toHaveLength(2);
      expect('meta' in pagedClose && pagedClose.meta?.total).toBe(5);
      const historical = await service.closes(t, period, 3);
      expect(
        'snapshot' in historical && historical.snapshot?.participations.length,
      ).toBe(5);
      await expect(
        service.decision(
          t,
          period,
          arrival.participation,
          {
            ...DEFAULT_DECISION,
            instanceToken: token,
            expectedVersion: Number(close2.version),
            decisionVersion: 0,
            reviewStatus: 'reviewed',
          },
          randomUUID(),
        ),
      ).rejects.toThrow();

      const workerTx = new FiscalTenantTransactionService(worker);
      await db.query(
        `INSERT INTO cfdi_period_reconciliations(cfdi_id,organization_id,client_account_id,legal_entity_id,status) VALUES($1,$2,$3,$4,'ready')`,
        [payment.cfdi, org, account, entity],
      );
      await db.query(
        `INSERT INTO cfdi_period_intents(id,organization_id,client_account_id,legal_entity_id,cfdi_id,participation_type,source_ordinal,literal_date,source_date,source_year,source_month,timezone,policy_version) VALUES($1,$2,$3,$4,$5,'payment',3,'2026-03-01T00:15:00','2026-03-01T06:15:00Z',2026,3,'America/Mexico_City','cfdi-period-participation/1.0.0')`,
        [randomUUID(), org, account, entity, payment.cfdi],
      );
      const [claim] = await workerTx.runWorkerMaintenance((m) =>
        m.query<MonthlyReconciliationClaim[]>(
          'SELECT * FROM claim_monthly_reconciliation()',
        ),
      );
      expect(claim.cfdi_id).toBe(payment.cfdi);
      await resolveMonthlyClaim(workerTx, {
        ...claim,
        lease_token: randomUUID(),
      });
      expect(
        (
          await db.query<{ status: string }[]>(
            'SELECT status FROM cfdi_period_reconciliations WHERE cfdi_id=$1',
            [payment.cfdi],
          )
        )[0].status,
      ).toBe('ready');
      await resolveMonthlyClaim(workerTx, claim);
      expect(
        (
          await db.query<{ status: string }[]>(
            'SELECT status FROM cfdi_period_reconciliations WHERE cfdi_id=$1',
            [payment.cfdi],
          )
        )[0].status,
      ).toBe('ready');
      const march = randomUUID();
      await db.query(
        `INSERT INTO periods(id,organization_id,client_account_id,legal_entity_id,fiscal_year_id,month,status,lock_version) VALUES($1,$2,$3,$4,$5,3,'not_started',0)`,
        [march, org, account, entity, year],
      );
      await db.query(
        "UPDATE organizations SET timezone='America/Tijuana' WHERE id=$1",
        [org],
      );
      await db.query(
        "UPDATE cfdi_period_reconciliations SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE cfdi_id=$1",
        [payment.cfdi],
      );
      const [retryClaim] = await workerTx.runWorkerMaintenance((m) =>
        m.query<MonthlyReconciliationClaim[]>(
          'SELECT * FROM claim_monthly_reconciliation()',
        ),
      );
      await resolveMonthlyClaim(workerTx, retryClaim);
      await resolveMonthlyClaim(workerTx, retryClaim);
      const recovered = await db.query<
        { timezone: string; source_date: Date }[]
      >(
        'SELECT timezone,source_date FROM period_cfdis WHERE cfdi_id=$1 AND source_ordinal=3 AND period_id=$2',
        [payment.cfdi, march],
      );
      expect(recovered).toHaveLength(1);
      expect(recovered[0].timezone).toBe('America/Mexico_City');
      expect(recovered[0].source_date.toISOString()).toBe(
        '2026-03-01T06:15:00.000Z',
      );
      const [{ n: resolvedAudit }] = await db.query<{ n: number }[]>(
        "SELECT count(*)::int AS n FROM audit_events WHERE object_id=$1 AND action='monthly.participation_reconciled'",
        [payment.cfdi],
      );
      expect(resolvedAudit).toBe(1);
      const secondUser = randomUUID(),
        secondMember = randomUUID(),
        secondSession = randomUUID();
      const [accountantRole] = await db.query<{ id: string }[]>(
        "SELECT id FROM roles WHERE key='accountant'",
      );
      await db.query(
        `INSERT INTO users(id,first_name,last_name,email,status,password_hash,email_verified_at) VALUES($1,'Persona','Dos',$2,'active','no-login',clock_timestamp())`,
        [secondUser, 'monthly-second-' + suffix + '@example.invalid'],
      );
      await db.query(
        `INSERT INTO memberships(id,organization_id,user_id,role_id,status,joined_at) VALUES($1,$2,$3,$4,'active',clock_timestamp())`,
        [secondMember, org, secondUser, accountantRole.id],
      );
      await db.query(
        `INSERT INTO account_assignments(id,organization_id,client_account_id,membership_id,status,assigned_by_membership_id,responsibility,assigned_at) VALUES($1,$2,$3,$4,'active',$5,'reviewer',clock_timestamp())`,
        [randomUUID(), org, account, secondMember, member],
      );
      await db.query(
        `INSERT INTO auth_factors(id,user_id,status,secret_encrypted,verified_at) VALUES($1,$2,'active','synthetic-unused',clock_timestamp())`,
        [randomUUID(), secondUser],
      );
      await db.query(
        `INSERT INTO auth_sessions(id,user_id,organization_id,membership_id,session_token_hash,status,requires_mfa,mfa_verified_at,reauthenticated_at,expires_at,last_activity_at) VALUES($1,$2,$3,$4,$5,'active',true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp())`,
        [
          secondSession,
          secondUser,
          org,
          secondMember,
          randomBytes(32).toString('hex'),
        ],
      );
      const secondTenant = (
        await authorization.revalidateSession(secondSession)
      ).context;
      const secondToken = randomBytes(32).toString('hex');
      expect(secondTenant.permissions).not.toContain('cfdi.categories.manage');
      const takeover = await service.acquire(
        secondTenant,
        period,
        {
          instanceToken: secondToken,
          reason: 'Retomar revisión por cambio de responsable',
        },
        true,
      );
      expect(takeover.version).toBe(Number(close2.version));
      await expect(
        service.renew(t, period, {
          instanceToken: token,
          expectedVersion: takeover.version,
        }),
      ).rejects.toThrow();
      const resumed = await service.reopen(
        secondTenant,
        period,
        {
          instanceToken: secondToken,
          expectedVersion: takeover.version,
          reason: 'Documentar incidencia y nuevos comprobantes',
        },
        randomUUID(),
      );
      const incident = randomUUID();
      await db.query(
        `INSERT INTO incidents(id,organization_id,client_account_id,legal_entity_id,cfdi_id,code,severity,status) VALUES($1,$2,$3,$4,$5,'CFDI_RELATION_NOT_FOUND','medium','open')`,
        [incident, org, account, entity, income.cfdi],
      );
      const managed = await service.manageIncident(
        secondTenant,
        period,
        incident,
        {
          instanceToken: secondToken,
          expectedVersion: Number(resumed.version),
          incidentVersion: 0,
          state: 'client_clarification',
          reason: 'Solicitar aclaración del soporte',
          responsibleMembershipId: secondMember,
          comment: 'Seguimiento manual de QA',
        },
        randomUUID(),
      );
      const resolved = await service.manageIncident(
        secondTenant,
        period,
        incident,
        {
          instanceToken: secondToken,
          expectedVersion: Number(managed.version),
          incidentVersion: 1,
          state: 'resolved',
          reason: 'Aclaración documentada por el responsable',
          responsibleMembershipId: secondMember,
          comment: 'Sin inferencia fiscal',
        },
        randomUUID(),
      );
      expect(Number(resolved.version)).toBe(Number(managed.version) + 1);
      const [managementAudit] = await db.query<{ actor_user_id: string }[]>(
        "SELECT actor_user_id FROM audit_events WHERE action='monthly.incident_managed' AND object_id=$1 ORDER BY occurred_at DESC LIMIT 1",
        [incident],
      );
      expect(managementAudit.actor_user_id).toBe(secondUser);
      const managementHistory = await service.incidentHistory(
        secondTenant,
        period,
        incident,
        1,
        1,
      );
      expect(managementHistory.meta.total).toBe(2);
      expect(managementHistory.items[0].state).toBe('resolved');
      expect(
        (await service.incidents(secondTenant, period, 1, 1)).items[0].cfdiUuid,
      ).toBeDefined();
      const secondReview = await service.decision(
        secondTenant,
        period,
        arrival.participation,
        {
          ...DEFAULT_DECISION,
          reviewStatus: 'reviewed',
          instanceToken: secondToken,
          expectedVersion: Number(resolved.version),
          decisionVersion: 0,
        },
        randomUUID(),
      );
      const secondPreparation = await service.prepareClose(
        secondTenant,
        period,
        {
          instanceToken: secondToken,
          expectedVersion: Number(secondReview.version),
        },
      );
      const secondClose = await service.close(
        secondTenant,
        period,
        {
          instanceToken: secondToken,
          expectedVersion: secondPreparation.version,
        },
        randomUUID(),
      );
      expect(secondClose.closeVersion).toBe(4);
      const paymentNode = randomUUID();
      const [{ normalized_uuid: invoiceUuid }] = await db.query<
        { normalized_uuid: string }[]
      >('SELECT normalized_uuid FROM cfdis WHERE id=$1', [income.cfdi]);
      await db.query(
        `INSERT INTO cfdi_payments(id,organization_id,client_account_id,legal_entity_id,cfdi_id,ordinal,payment_date,payment_form,currency,amount) VALUES($1,$2,$3,$4,$5,1,'2026-02-05','03','MXN',10)`,
        [paymentNode, org, account, entity, payment.cfdi],
      );
      await db.query(
        `INSERT INTO cfdi_payment_documents(id,organization_id,client_account_id,legal_entity_id,cfdi_id,payment_id,ordinal,related_uuid,currency,installment_number,previous_balance,paid_amount,remaining_balance,tax_object_code) VALUES($1,$2,$3,$4,$5,$6,1,$7,'MXN',1,100,10,90,'01')`,
        [
          randomUUID(),
          org,
          account,
          entity,
          payment.cfdi,
          paymentNode,
          invoiceUuid,
        ],
      );
      expect(
        (await service.news(secondTenant, period)).changed.map((x) => x.id),
      ).toContain(income.participation);
      expect(
        (await service.overview(secondTenant, period)).counts.documents,
      ).toBe(6);
      const nextArrival = await addDocument('E', '15');
      expect(
        (await service.news(secondTenant, period)).added.map((x) => x.id),
      ).toContain(nextArrival.participation);
      const reopenedAfterArrival = await service.reopen(
        secondTenant,
        period,
        {
          instanceToken: secondToken,
          expectedVersion: Number(secondClose.version),
          reason: 'Revisar documento recibido después del cierre',
        },
        randomUUID(),
      );
      expect(reopenedAfterArrival.status).toBe('reopened');
      const retained = await service.closes(secondTenant, period, 4);
      expect('meta' in retained && retained.meta?.total).toBe(6);
      const twoTabs = await Promise.allSettled([
        service.acquire(t, month2, {
          instanceToken: randomBytes(32).toString('hex'),
        }),
        service.acquire(secondTenant, month2, {
          instanceToken: randomBytes(32).toString('hex'),
        }),
      ]);
      expect(twoTabs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      await db.query(
        "UPDATE account_assignments SET status='revoked',revoked_at=clock_timestamp(),revoked_by_membership_id=$3 WHERE organization_id=$1 AND membership_id=$2",
        [org, secondMember, member],
      );
      await expect(service.overview(secondTenant, period)).rejects.toThrow();
      const payroll = await addDocument('N', '100');
      const [payrollPermission] = await db.query<{ id: string }[]>(
        "SELECT id FROM permissions WHERE key='payroll.view'",
      );
      await db.query(
        `INSERT INTO membership_permissions(organization_id,membership_id,permission_id,effect,granted_by_membership_id,granted_at) VALUES($1,$2,$3,'deny',$2,clock_timestamp())`,
        [org, member, payrollPermission.id],
      );
      const noPayroll = (await authorization.revalidateSession(session))
        .context;
      expect((await service.overview(noPayroll, period)).counts.documents).toBe(
        7,
      );
      await expect(service.closes(noPayroll, period, 3)).rejects.toThrow();
      await expect(
        service.decision(
          noPayroll,
          period,
          payroll.participation,
          {
            ...DEFAULT_DECISION,
            instanceToken: token,
            expectedVersion: Number(close2.version),
            decisionVersion: 0,
          },
          randomUUID(),
        ),
      ).rejects.toThrow();

      await db.query(
        "UPDATE auth_sessions SET status='revoked',revoked_at=clock_timestamp() WHERE id=$1",
        [session],
      );
      await expect(service.overview(t, period)).rejects.toThrow();
      console.info(
        'MONTHLY_POSTGRES_ASSERTIONS',
        expect.getState().assertionCalls,
      );
    } finally {
      if (pendingImport) {
        if (pendingImport.isTransactionActive)
          await pendingImport.rollbackTransaction();
        await pendingImport.release();
      }
      if (worker?.isInitialized) await worker.destroy();
      if (api?.isInitialized) await api.destroy();
      if (db?.isInitialized) await db.destroy();
      if (admin.isInitialized) {
        assert.match(
          database,
          /^test_monthly_[0-9a-f]{12}$/,
          'Unsafe cleanup scope',
        );
        await admin.query(
          'DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)',
        );
        await admin.query('DROP ROLE IF EXISTS "' + login + '"');
        await admin.query('DROP ROLE IF EXISTS "' + workerLogin + '"');
        await admin.destroy();
      }
    }
  }, 120000);
});
