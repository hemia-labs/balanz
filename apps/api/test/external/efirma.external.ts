/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import {
  getDatabaseOptions,
  withRuntimeDatabaseRole,
} from '../../src/config/database.config';
import fiscalConfig from '../../src/config/fiscal-platform.config';
import { seedDatabase } from '../../src/database/seeds/seed-database';
import { FiscalTenantTransactionService } from '../../src/database/rls/fiscal-tenant-transaction.service';
import { EfirmaRepository } from '../../src/modules/efirma/efirma.repository';
import { EfirmaPreparationService } from '../../src/modules/efirma/efirma-preparation.service';
import { EfirmaConsumerService } from '../../src/modules/efirma/efirma-consumer.service';
import { EfirmaCleanupService } from '../../src/modules/efirma/efirma-cleanup.service';
import { VaultCustodyAdapter } from '../../src/modules/efirma/vault-custody.adapter';
import { S3ObjectStorageAdapter } from '../../src/modules/object-storage/adapters/s3/s3-object-storage.adapter';
import { OpaqueObjectKeyFactory } from '../../src/modules/object-storage/services/opaque-object-key.factory';
import type { SessionAuthorizationContext } from '../../src/modules/sessions/session.types';
import { syntheticCredential } from '../fixtures/efirma-fixture';

const docker = (args: string[]) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
function containerEnvironment(name: string): Record<string, string> {
  const values = JSON.parse(
    docker(['inspect', '--format', '{{json .Config.Env}}', name]),
  ) as string[];
  return Object.fromEntries(
    values.map((value) => {
      const at = value.indexOf('=');
      return [value.slice(0, at), value.slice(at + 1)];
    }),
  );
}

describe('Phase 3 real isolated PostgreSQL, Vault and private MinIO', () => {
  it('prepares, consumes once, cleans, isolates scope and invalidates restored custody', async () => {
    if (process.env.RUN_EFIRMA_INTEGRATION !== 'true')
      throw new Error(
        'Opt in with RUN_EFIRMA_INTEGRATION=true; this creates only disposable synthetic QA resources.',
      );
    const suffix = randomBytes(6).toString('hex');
    const database = `test_efirma_${suffix}`;
    const container = `hemia-efirma-${suffix}`;
    const directory = mkdtempSync(join(tmpdir(), 'hemia-efirma-qa-'));
    const rootToken = randomBytes(32).toString('hex');
    const postgres = containerEnvironment('balanz-cfdi-phase0-postgres-1');
    const minio = containerEnvironment('balanz-cfdi-phase0-minio-bootstrap-1');
    const options = getDatabaseOptions({
      host: '127.0.0.1',
      port: 55432,
      username: postgres.POSTGRES_USER,
      password: postgres.POSTGRES_PASSWORD,
      name: postgres.POSTGRES_DB,
      logging: false,
      connectionTimeoutMs: 3000,
    });
    if (options.type !== 'postgres') throw new Error('PostgreSQL required');
    const admin = new DataSource({ ...options, entities: [], migrations: [] });
    let db: DataSource | undefined;
    const runtimes: DataSource[] = [];
    const logins = [`efirma_api_${suffix}`, `efirma_worker_${suffix}`];
    let vaultStarted = false;
    let count = 0;
    const check = (condition: unknown, label: string) => {
      count++;
      if (!condition) throw new Error(`Phase 3 assertion: ${label}`);
    };
    const storedKeys: string[] = [];
    const storage = new S3ObjectStorageAdapter(
      {
        driver: 's3',
        endpoint: 'http://127.0.0.1:59000',
        allowInsecureEndpoint: true,
        forcePathStyle: true,
        region: 'us-east-2',
        bucket: 'balanz-cfdi-phase0-test',
        maxBytes: 32768,
        requestTimeoutMs: 5000,
        credentials: {
          accessKeyId: minio.MINIO_APP_USER,
          secretAccessKey: minio.MINIO_APP_PASSWORD,
        },
        serverSideEncryption: 'AES256',
        signedUrlTtlSeconds: 30,
      },
      new OpaqueObjectKeyFactory(),
    );
    try {
      docker([
        'run',
        '--detach',
        '--rm',
        '--name',
        container,
        '--publish',
        '127.0.0.1::8200',
        '--cap-add=IPC_LOCK',
        '--env',
        `VAULT_DEV_ROOT_TOKEN_ID=${rootToken}`,
        '--env',
        'VAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200',
        'hashicorp/vault:1.20.4',
        'server',
        '-dev',
      ]);
      vaultStarted = true;
      const port = docker(['port', container, '8200']).trim().split(':').at(-1);
      const address = `http://127.0.0.1:${port}`;
      const rootRequest = async (path: string, body?: object) => {
        const response = await fetch(`${address}/v1/${path}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            'X-Vault-Token': rootToken,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok)
          throw new Error(`Synthetic Vault setup failed (${response.status})`);
        return response.status === 204
          ? {}
          : ((await response.json()) as Record<string, any>);
      };
      const deadline = Date.now() + 20000;
      while (true) {
        try {
          await rootRequest('sys/health');
          break;
        } catch {
          if (Date.now() > deadline)
            throw new Error('Synthetic Vault did not start');
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      await rootRequest('sys/mounts/efirma-transit', { type: 'transit' });
      await rootRequest('efirma-transit/keys/wrapping', {
        type: 'aes256-gcm96',
        derived: true,
        exportable: false,
        allow_plaintext_backup: false,
      });
      await rootRequest('sys/auth/approle', { type: 'approle' });
      const identity = async (name: string, policy: string) => {
        await rootRequest(`sys/policies/acl/${name}`, { policy });
        await rootRequest(`auth/approle/role/${name}`, {
          token_policies: [name],
          token_ttl: '5m',
          token_max_ttl: '10m',
          secret_id_ttl: '10m',
          token_no_default_policy: true,
        });
        const role = await rootRequest(`auth/approle/role/${name}/role-id`);
        const secret = await rootRequest(
          `auth/approle/role/${name}/secret-id`,
          {},
        );
        return {
          roleId: role.data.role_id as string,
          secretId: secret.data.secret_id as string,
        };
      };
      const preparer = await identity(
        'preparer',
        'path "sys/wrapping/wrap" { capabilities=["update"] }\npath "efirma-transit/encrypt/wrapping" { capabilities=["update"] }',
      );
      const consumer = await identity(
        'consumer',
        'path "sys/wrapping/unwrap" { capabilities=["update"] }\npath "efirma-transit/decrypt/wrapping" { capabilities=["update"] }',
      );
      const cleanup = await identity(
        'cleanup',
        'path "auth/token/revoke-accessor" { capabilities=["update"] }',
      );
      await admin.initialize();
      await admin.query(`CREATE DATABASE "${database}"`);
      db = new DataSource({ ...options, database });
      await db.initialize();
      await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await db.runMigrations({ transaction: 'all' });
      await seedDatabase(db);
      check(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM migrations WHERE name='PhaseThreeEfirmaCustody1787691000000'`,
          )
        )[0].n === 1,
        'one new migration applied',
      );
      for (const [index, role] of ['balanz_api', 'balanz_worker'].entries()) {
        const password = randomBytes(24).toString('hex');
        await admin.query(
          `CREATE ROLE "${logins[index]}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
        );
        await admin.query(`GRANT ${role} TO "${logins[index]}"`);
        const runtime = new DataSource(
          withRuntimeDatabaseRole(
            {
              ...options,
              database,
              username: logins[index],
              password,
              migrations: [],
            },
            role as 'balanz_api' | 'balanz_worker',
          ),
        );
        await runtime.initialize();
        runtimes.push(runtime);
      }
      const fixture = await syntheticCredential();
      const trustFile = join(directory, 'trust.json');
      const generationFile = join(directory, 'generation');
      const generation = randomUUID();
      writeFileSync(trustFile, JSON.stringify(fixture.trust));
      writeFileSync(generationFile, generation);
      const vaultBase = {
        address,
        transitMount: 'efirma-transit',
        transitKey: 'wrapping',
      };
      const fiscal = fiscalConfig();
      fiscal.storage.driver = 's3';
      fiscal.storage.s3.bucket = 'balanz-cfdi-phase0-test';
      const configuration = (worker: boolean) =>
        new ConfigService({
          fiscalPlatform: fiscal,
          efirma: {
            enabled: true,
            generationFile,
            syntheticTrustFile: trustFile,
            sessionIdleSeconds: 1800,
            vault: { ...vaultBase, identity: worker ? consumer : preparer },
            cleanupVault: { ...vaultBase, identity: cleanup },
          },
        });
      const apiRepository = new EfirmaRepository(
        new FiscalTenantTransactionService(runtimes[0]),
        configuration(false),
      );
      const workerRepository = new EfirmaRepository(
        new FiscalTenantTransactionService(runtimes[1]),
        configuration(true),
      );
      const preparation = new EfirmaPreparationService(
        apiRepository,
        configuration(false),
        storage,
      );
      const consumption = new EfirmaConsumerService(workerRepository, storage);
      const cleaner = new EfirmaCleanupService(workerRepository, storage);
      const tenant: SessionAuthorizationContext = {
        userId: randomUUID(),
        sessionId: randomUUID(),
        organizationId: randomUUID(),
        membershipId: randomUUID(),
        role: 'owner',
        permissions: ['credentials.manage'],
        assignedAccountIds: [],
        accountAccessMode: 'tenant',
        mfaVerifiedAt: new Date(),
        reauthenticatedAt: new Date(),
        requiresMfa: true,
        mfaStatus: 'active',
        expiresAt: new Date(Date.now() + 3600000),
        tenantActive: true,
        reauthenticationRequiredActions: [],
      };
      const account = randomUUID();
      const entity = randomUUID();
      const role = (
        await db.query(`SELECT id FROM roles WHERE key='accountant'`)
      )[0];
      await db.query(
        `INSERT INTO users(id,first_name,last_name,email,status,password_hash,email_verified_at) VALUES($1,'Synthetic','QA',$2,'active','no-login',clock_timestamp())`,
        [tenant.userId, `efirma-${suffix}@example.invalid`],
      );
      await db.query(
        `INSERT INTO organizations(id,name,slug,owner_user_id,status,timezone) VALUES($1,'Synthetic QA',$2,$3,'active','America/Mexico_City')`,
        [tenant.organizationId, `efirma-${suffix}`, tenant.userId],
      );
      await db.query(
        `INSERT INTO memberships(id,organization_id,user_id,role_id,status,joined_at) VALUES($1,$2,$3,$4,'active',clock_timestamp())`,
        [tenant.membershipId, tenant.organizationId, tenant.userId, role.id],
      );
      await db.query(
        `INSERT INTO client_accounts(id,organization_id,name,status) VALUES($1,$2,'Synthetic QA','active')`,
        [account, tenant.organizationId],
      );
      await db.query(
        `INSERT INTO legal_entities(id,organization_id,client_account_id,rfc,legal_name,status) VALUES($1,$2,$3,'AAA010101AAA','Synthetic QA','active')`,
        [entity, tenant.organizationId, account],
      );
      await db.query(
        `INSERT INTO auth_factors(id,user_id,status,secret_encrypted,verified_at) VALUES($1,$2,'active','synthetic-unused',clock_timestamp())`,
        [randomUUID(), tenant.userId],
      );
      await db.query(
        `INSERT INTO auth_sessions(id,user_id,organization_id,membership_id,session_token_hash,status,requires_mfa,mfa_verified_at,reauthenticated_at,expires_at,last_activity_at)
        VALUES($1,$2,$3,$4,$5,'active',true,clock_timestamp(),clock_timestamp(),$6,clock_timestamp())`,
        [
          tenant.sessionId,
          tenant.userId,
          tenant.organizationId,
          tenant.membershipId,
          randomBytes(32).toString('hex'),
          tenant.expiresAt,
        ],
      );
      const makeInput = (grant: string) => {
        const password = Buffer.from(fixture.password);
        return {
          certificate: fixture.certificate,
          encryptedKey: fixture.encryptedKey,
          password,
          grant,
          dispose: () => password.fill(0),
        };
      };
      const issue = async () => {
        await db!.query(
          `UPDATE auth_sessions SET reauthenticated_at=clock_timestamp() WHERE id=$1`,
          [tenant.sessionId],
        );
        return apiRepository.issueGrant(tenant, entity, randomUUID());
      };
      const admitted = await issue();
      check(
        Date.parse(admitted.expiresAt.toISOString()) - Date.now() <= 600000,
        'fiscal grant at most 600s',
      );
      const key = randomUUID();
      const prepared = await preparation.prepare(
        tenant,
        entity,
        key,
        makeInput(admitted.grant),
        randomUUID(),
      );
      check(
        prepared.status === 'ready',
        'real wrapping and Transit preparation',
      );
      const again = await preparation.prepare(
        tenant,
        entity,
        key,
        makeInput(admitted.grant),
        randomUUID(),
      );
      check(
        again.id === prepared.id,
        'idempotent creation without another grant consumption',
      );
      const raw = (
        await db.query('SELECT * FROM efirma_sessions WHERE id=$1', [
          prepared.id,
        ])
      )[0];
      check(
        String(raw.wrapped_token_ciphertext).startsWith('vault:v'),
        'only Transit ciphertext persisted',
      );
      check(
        !JSON.stringify(prepared).includes('vault:') &&
          !JSON.stringify(prepared).includes(admitted.grant),
        'public DTO excludes bearer and ciphertext',
      );
      const permission = (
        await db.query(
          `SELECT id FROM permissions WHERE key='credentials.manage'`,
        )
      )[0];
      const deny = randomUUID();
      await db.query(
        `INSERT INTO membership_permissions(id,organization_id,membership_id,permission_id,effect,granted_by_membership_id,granted_at)
        VALUES($1,$2,$3,$4,'deny',$3,clock_timestamp())`,
        [deny, tenant.organizationId, tenant.membershipId, permission.id],
      );
      await expect(
        consumption.withCredential(tenant.organizationId!, prepared.id, () =>
          Promise.resolve(),
        ),
      ).rejects.toBeDefined();
      count++;
      await db.query(
        'UPDATE membership_permissions SET revoked_at=clock_timestamp(),revoked_by_membership_id=$2 WHERE id=$1',
        [deny, tenant.membershipId],
      );
      check(
        (
          await db.query(
            `SELECT count(*)::int n FROM pg_class WHERE relname IN('fiscal_reauth_grants','efirma_sessions') AND relrowsecurity AND relforcerowsecurity`,
          )
        )[0].n === 2,
        'both new tables enforce FORCE RLS',
      );
      let used = 0;
      const races = await Promise.allSettled(
        [1, 2].map(() =>
          consumption.withCredential(
            tenant.organizationId!,
            prepared.id,
            async (key, cert, authority) => {
              await authority();
              check(
                cert.checkPrivateKey(key),
                'consumer obtains matching synthetic key',
              );
              used++;
            },
          ),
        ),
      );
      check(
        used === 1 &&
          races.filter((item) => item.status === 'fulfilled').length === 1,
        'exclusive consumer one winner',
      );
      await cleaner.reconcile();
      const cleaned = (
        await db.query('SELECT * FROM efirma_sessions WHERE id=$1', [
          prepared.id,
        ])
      )[0];
      check(
        cleaned.status === 'consumed' &&
          cleaned.cleanup_completed_at &&
          cleaned.wrapped_token_ciphertext === null &&
          cleaned.private_key_object_id === null,
        'consumed cleanup erases operational secrets',
      );
      const concurrentGrant = await issue();
      const lateObject = (
        await db.query<{ object_key: string }[]>(
          'SELECT object_key FROM stored_objects WHERE id=$1',
          [raw.private_key_object_id],
        )
      )[0];
      await storage.putStream({
        objectKey: lateObject.object_key,
        body: Readable.from([Buffer.from('synthetic late encrypted write')]),
      });
      await db.query(
        `UPDATE stored_objects SET retention_until=clock_timestamp()-interval '60 seconds',updated_at=clock_timestamp()-interval '6 minutes' WHERE id=$1`,
        [raw.private_key_object_id],
      );
      await cleaner.reconcile();
      check(
        (await storage.head(lateObject.object_key)) === null,
        'late orphan is reconciled after prior cleanup completion',
      );
      const beforeGrant = await issue();
      const before = await preparation.prepare(
        tenant,
        entity,
        randomUUID(),
        makeInput(beforeGrant.grant),
        randomUUID(),
      );
      const deniedConfig = configuration(true);
      deniedConfig.set('efirma.vault', { ...vaultBase, identity: preparer });
      const deniedConsumer = new EfirmaConsumerService(
        new EfirmaRepository(
          new FiscalTenantTransactionService(runtimes[1]),
          deniedConfig,
        ),
        storage,
      );
      await expect(
        deniedConsumer.withCredential(tenant.organizationId!, before.id, () =>
          Promise.resolve(),
        ),
      ).rejects.toBeDefined();
      count++;
      check(
        (
          await db.query('SELECT status FROM efirma_sessions WHERE id=$1', [
            before.id,
          ])
        )[0].status === 'claimed',
        'failure before unwrap remains recoverable',
      );
      await db.query(
        `UPDATE efirma_sessions SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`,
        [before.id],
      );
      let recovered = 0;
      await consumption.withCredential(
        tenant.organizationId!,
        before.id,
        () => {
          recovered++;
          return Promise.resolve();
        },
      );
      check(
        recovered === 1,
        'expired pre-unwrap claim recovers without another wrapping operation',
      );
      await cleaner.reconcileOne(tenant.organizationId!, before.id, generation);
      const afterGrant = await issue();
      const after = await preparation.prepare(
        tenant,
        entity,
        randomUUID(),
        makeInput(afterGrant.grant),
        randomUUID(),
      );
      // Captured only for explicit .call(this, ...) to inject a crash after the real unwrap.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const actualUnwrap = VaultCustodyAdapter.prototype.unwrap;
      const fault = jest
        .spyOn(VaultCustodyAdapter.prototype, 'unwrap')
        .mockImplementation(async function (
          this: VaultCustodyAdapter,
          token,
          context,
        ) {
          const dek: Buffer = await actualUnwrap.call(this, token, context);
          dek.fill(0);
          throw new Error('Synthetic crash after real unwrap');
        });
      try {
        await expect(
          consumption.withCredential(tenant.organizationId!, after.id, () =>
            Promise.resolve(),
          ),
        ).rejects.toBeDefined();
        check(
          (
            await db.query('SELECT status FROM efirma_sessions WHERE id=$1', [
              after.id,
            ])
          )[0].status === 'requires_user_authorization',
          'lost DEK after real unwrap requires authorization',
        );
        await expect(
          consumption.withCredential(tenant.organizationId!, after.id, () =>
            Promise.resolve(),
          ),
        ).rejects.toBeDefined();
        check(
          fault.mock.calls.length === 1,
          'never repeats a consumed or uncertain unwrap',
        );
      } finally {
        fault.mockRestore();
      }
      await db.query(
        'UPDATE efirma_sessions SET wrapping_expires_at=clock_timestamp() WHERE id=$1',
        [after.id],
      );
      await cleaner.reconcileOne(tenant.organizationId!, after.id, generation);
      const reservations = await Promise.allSettled(
        [1, 2].map(() =>
          apiRepository.reserve(
            tenant,
            entity,
            randomUUID(),
            'a'.repeat(64),
            concurrentGrant.grant,
            undefined,
            randomUUID(),
          ),
        ),
      );
      check(
        reservations.filter((result) => result.status === 'fulfilled')
          .length === 1,
        'atomic grant consumption one winner',
      );
      const reservation = reservations.find(
        (result) => result.status === 'fulfilled',
      );
      if (reservation?.status === 'fulfilled') {
        await db.query(
          `UPDATE efirma_sessions SET lease_until=clock_timestamp()-interval '10 seconds' WHERE id=$1`,
          [reservation.value.row.id],
        );
        await cleaner.reconcileOne(
          tenant.organizationId!,
          reservation.value.row.id,
          generation,
        );
        check(
          (
            await db.query('SELECT status FROM efirma_sessions WHERE id=$1', [
              reservation.value.row.id,
            ])
          )[0].status === 'requires_user_authorization',
          'lost preparation never recovers password',
        );
      }
      const expiredGrant = await issue();
      await db.query(
        `UPDATE fiscal_reauth_grants SET created_at=clock_timestamp()-interval '600 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1`,
        [createHash('sha256').update(expiredGrant.grant).digest('hex')],
      );
      await expect(
        apiRepository.reserve(
          tenant,
          entity,
          randomUUID(),
          'b'.repeat(64),
          expiredGrant.grant,
          undefined,
          randomUUID(),
        ),
      ).rejects.toBeDefined();
      count++;
      const revocableGrant = await issue();
      const revocable = await preparation.prepare(
        tenant,
        entity,
        randomUUID(),
        makeInput(revocableGrant.grant),
        randomUUID(),
      );
      check(
        (await apiRepository.revoke(tenant, entity, revocable.id, randomUUID()))
          .status === 'revoked',
        'explicit revocation durable',
      );
      check(
        (await apiRepository.revoke(tenant, entity, revocable.id, randomUUID()))
          .status === 'revoked',
        'revocation idempotent',
      );
      await expect(
        consumption.withCredential(tenant.organizationId!, revocable.id, () =>
          Promise.resolve(),
        ),
      ).rejects.toBeDefined();
      count++;
      await cleaner.reconcileOne(
        tenant.organizationId!,
        revocable.id,
        generation,
      );
      const rotationGrant = await issue();
      const rotation = await preparation.prepare(
        tenant,
        entity,
        randomUUID(),
        makeInput(rotationGrant.grant),
        randomUUID(),
      );
      await db.query(
        'UPDATE auth_sessions SET session_token_hash=$2 WHERE id=$1',
        [tenant.sessionId, randomBytes(32).toString('hex')],
      );
      check(
        (
          await db.query(
            'SELECT status,auth_session_id FROM efirma_sessions WHERE id=$1',
            [rotation.id],
          )
        )[0].status === 'revoked',
        'session rotation immediately invalidates existing custody',
      );
      await cleaner.reconcileOne(
        tenant.organizationId!,
        rotation.id,
        generation,
      );
      const nextGrant = await issue();
      const next = await preparation.prepare(
        tenant,
        entity,
        randomUUID(),
        makeInput(nextGrant.grant),
        randomUUID(),
      );
      check(next.status === 'ready', 'second independent intention');
      writeFileSync(generationFile, randomUUID());
      await expect(
        consumption.withCredential(tenant.organizationId!, next.id, () => {
          used++;
          return Promise.resolve();
        }),
      ).rejects.toBeDefined();
      check(used === 1, 'restore generation denies old custody');
      await db.query(
        `UPDATE efirma_sessions SET lease_until=NULL WHERE id=$1`,
        [next.id],
      );
      await cleaner.reconcileOne(
        tenant.organizationId!,
        next.id,
        await workerRepository.generation(),
      );
      check(
        (
          await db.query('SELECT status FROM efirma_sessions WHERE id=$1', [
            next.id,
          ])
        )[0].status === 'revoked',
        'restore reconciliation revokes previous generation',
      );
      await expect(
        apiRepository.status(
          { ...tenant, organizationId: randomUUID() },
          entity,
          next.id,
        ),
      ).rejects.toBeDefined();
      count++;
      const rows: { object_key: string }[] = await db.query(
        `SELECT object_key FROM stored_objects WHERE kind IN('credential_certificate','credential_private_key')`,
      );
      storedKeys.push(
        ...rows.map((row: { object_key: string }) => row.object_key),
      );
      check(
        (
          await db.query(
            `SELECT count(*)::int n FROM stored_objects WHERE lifecycle_state<>'deleted'`,
          )
        )[0].n === 0,
        'private storage objects cleaned',
      );
      fixture.password.fill(0);
      console.log(
        JSON.stringify({
          phase3SyntheticIntegration: 'PASS',
          assertions: count,
          realServices: [
            'PostgreSQL',
            'Vault AppRole/wrapping/Transit',
            'private MinIO SSE',
          ],
          realCredentials: false,
        }),
      );
    } finally {
      if (db?.isInitialized) {
        const rows: { object_key: string }[] = await db
          .query(
            `SELECT object_key FROM stored_objects WHERE kind IN('credential_certificate','credential_private_key')`,
          )
          .catch(() => []);
        storedKeys.push(
          ...rows.map((row: { object_key: string }) => row.object_key),
        );
      }
      for (const key of new Set(storedKeys))
        await storage.delete(key).catch(() => undefined);
      for (const runtime of runtimes)
        if (runtime.isInitialized) await runtime.destroy();
      if (db?.isInitialized) await db.destroy();
      if (admin.isInitialized) {
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH(FORCE)`);
        for (const name of logins)
          await admin.query(`DROP ROLE IF EXISTS "${name}"`);
        await admin.destroy();
      }
      if (vaultStarted) docker(['rm', '--force', container]);
      rmSync(directory, { recursive: true, force: true });
    }
  }, 180000);
});
