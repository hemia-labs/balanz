import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import {
  getDatabaseOptions,
  withRuntimeDatabaseRole,
} from '../../src/config/database.config';
import { seedDatabase } from '../../src/database/seeds/seed-database';
import { FiscalTenantTransactionService } from '../../src/database/rls/fiscal-tenant-transaction.service';
import { MonthlyReconciliationService } from '../../src/modules/cfdi/workers/monthly-reconciliation.service';
import { S3ObjectStorageAdapter } from '../../src/modules/object-storage/adapters/s3/s3-object-storage.adapter';
import { OpaqueObjectKeyFactory } from '../../src/modules/object-storage/services/opaque-object-key.factory';
import { SaxesCfdiParserAdapter } from '../../src/modules/cfdi-parser/adapters/saxes/saxes-cfdi-parser.adapter';
import { ClamAvScannerAdapter } from '../../src/modules/malware-scanner/adapters/clamav/clamav-scanner.adapter';

describe('Phase 5 legacy recovery with real PostgreSQL and MinIO', () => {
  it('recovers an intact original and preserves a recoverable missing original', async () => {
    if (process.env.RUN_MONTHLY_LEGACY_INTEGRATION !== 'true')
      throw new Error('Explicit isolated QA authorization required');
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

    let worker: DataSource | undefined;
    const workerLogin = 'monthly_worker_' + suffix;

    const minioEnv = JSON.parse(
      execFileSync(
        'docker',
        [
          'inspect',
          '--format',
          '{{json .Config.Env}}',
          'balanz-cfdi-phase0-minio-bootstrap-1',
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 15000 },
      ),
    ) as string[];
    const minio = Object.fromEntries(
      minioEnv.map((x) => {
        const i = x.indexOf('=');
        return [x.slice(0, i), x.slice(i + 1)];
      }),
    );
    const keys = new OpaqueObjectKeyFactory(
      'monthly-legacy-' + suffix + '/objects',
    );
    const storage = new S3ObjectStorageAdapter(
      {
        driver: 's3',
        endpoint: 'http://127.0.0.1:59000',
        allowInsecureEndpoint: true,
        forcePathStyle: true,
        region: 'us-east-2',
        bucket: 'balanz-cfdi-phase0-test',
        maxBytes: 5 * 1024 * 1024,
        requestTimeoutMs: 10000,
        credentials: {
          accessKeyId: minio.MINIO_APP_USER,
          secretAccessKey: minio.MINIO_APP_PASSWORD,
        },
        serverSideEncryption: 'AES256',
      },
      keys,
    );
    const ownedKeys: string[] = [];
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
        `INSERT INTO fiscal_years(id,organization_id,client_account_id,legal_entity_id,year,status,version) VALUES($1,$2,$3,$4,2026,'active',1)`,
        [year, org, account, entity],
      );
      await db.query(
        `INSERT INTO periods(id,organization_id,client_account_id,legal_entity_id,fiscal_year_id,month,status,lock_version) VALUES($1,$2,$3,$4,$5,1,'not_started',0)`,
        [period, org, account, entity, year],
      );

      const parser = new SaxesCfdiParserAdapter();
      const scanner = new ClamAvScannerAdapter({
        driver: 'clamav',
        host: '127.0.0.1',
        port: 53310,
        connectTimeoutMs: 2000,
        scanTimeoutMs: 15000,
        maxBytes: 5 * 1024 * 1024,
      });
      const xml = readFileSync(
        join(__dirname, '../fixtures/cfdi/valid-ingreso.xml'),
      );
      const parsed = await parser.parse(Readable.from(xml));

      await db.query('UPDATE periods SET month=8 WHERE id=$1', [period]);
      const createLegacy = async (available: boolean) => {
        const cfdi = randomUUID(),
          object = randomUUID(),
          key = keys.create();
        ownedKeys.push(key);
        const bytes = Buffer.from(
          xml
            .toString()
            .replace(new RegExp(parsed.document.stamp.uuid, 'i'), cfdi),
        );
        expect(
          (
            await parser.parse(Readable.from(bytes))
          ).document.stamp.uuid.toLowerCase(),
        ).toBe(cfdi);
        expect((await scanner.scan(Readable.from(bytes))).verdict).toBe(
          'clean',
        );
        const written = await storage.putStream({
          objectKey: key,
          body: Readable.from(bytes),
          expectedSizeBytes: bytes.length,
          contentType: 'application/xml',
        });
        if (!available) await storage.delete(key);
        await db!.query(
          `INSERT INTO stored_objects(id,organization_id,client_account_id,legal_entity_id,kind,storage_provider,storage_container,object_key,size_bytes,sha256,encryption_class,lifecycle_state,malware_scan_status,uploaded_at,malware_scanned_at,available_at) VALUES($1,$2,$3,$4,'manual_xml','s3','balanz-cfdi-phase0-test',$5,$6,$7,'fiscal','available','clean',clock_timestamp(),clock_timestamp(),clock_timestamp())`,
          [
            object,
            org,
            account,
            entity,
            key,
            written.sizeBytes,
            written.sha256,
          ],
        );
        await db!.query(
          `INSERT INTO cfdis(id,organization_id,client_account_id,legal_entity_id,source_object_id,normalized_uuid,cfdi_version,schema_version,parser_version,document_type,issued_at,certified_at,issuer_rfc,receiver_rfc,currency,subtotal,total) VALUES($1,$2,$3,$4,$5,$1,'4.0','test-schema','test-parser','I','2026-08-15T18:30:00Z','2026-08-15T18:31:00Z','AAA010101AAA','XAXX010101000','MXN','100','116')`,
          [cfdi, org, account, entity, object],
        );
        await db!.query(
          `INSERT INTO incidents(id,organization_id,client_account_id,legal_entity_id,cfdi_id,code,severity,status) VALUES($1,$2,$3,$4,$5,'FISCAL_PERIOD_NOT_CONFIGURED','medium','open')`,
          [randomUUID(), org, account, entity, cfdi],
        );
        return { cfdi, key, bytes };
      };
      const intact = await createLegacy(true),
        missing = await createLegacy(false);
      const service = new MonthlyReconciliationService(
        new FiscalTenantTransactionService(worker),
        storage,
        parser,
      );
      const rows = async (table: string, cfdi: string) => {
        assert.ok(
          [
            'cfdi_period_intents',
            'cfdi_period_reconciliations',
            'period_cfdis',
            'incidents',
          ].includes(table),
        );
        return db!.query<Record<string, unknown>[]>(
          'SELECT * FROM ' + table + ' WHERE cfdi_id=$1',
          [cfdi],
        );
      };
      expect(await rows('cfdi_period_intents', intact.cfdi)).toHaveLength(0);
      expect(await rows('period_cfdis', intact.cfdi)).toHaveLength(0);
      expect(await storage.head(missing.key)).toBeNull();
      expect(await service.reconcile()).toBe(2);
      const [intent] = await rows('cfdi_period_intents', intact.cfdi);
      expect(intent.literal_date).toBe('2026-08-15T12:30:00');
      expect(intent.source_year).toBe(2026);
      expect(intent.source_month).toBe(8);
      expect(intent.timezone).toBe('historical-unrecorded');
      expect(intent.policy_version).toBe('cfdi-period-participation/1.0.0');
      expect((intent.source_date as Date).toISOString()).toBe(
        '2026-08-15T18:30:00.000Z',
      );
      const participation = await rows('period_cfdis', intact.cfdi);
      expect(participation).toHaveLength(1);
      expect(participation[0].period_id).toBe(period);
      expect(
        (await rows('cfdi_period_reconciliations', intact.cfdi))[0].status,
      ).toBe('resolved');
      expect((await rows('incidents', intact.cfdi))[0].status).toBe('open'); // Original evidence is immutable.
      const [failed] = await rows('cfdi_period_reconciliations', missing.cfdi);
      expect(failed.status).toBe('failed');
      expect(failed.error_code).toBe('PARTICIPATION_RECONCILIATION_FAILED');
      expect(failed.lease_token).toBeNull();
      const visible = await new FiscalTenantTransactionService(api).run(
        { organizationId: org, membershipId: member },
        (m) =>
          m.query<{ status: string; code: string }[]>(
            'SELECT r.status,i.code FROM cfdi_period_reconciliations r JOIN incidents i ON i.cfdi_id=r.cfdi_id WHERE r.cfdi_id=$1',
            [missing.cfdi],
          ),
      );
      expect(visible).toEqual([
        { status: 'failed', code: 'FISCAL_PERIOD_NOT_CONFIGURED' },
      ]);
      expect((failed.next_attempt_at as Date).getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(await rows('cfdi_period_intents', missing.cfdi)).toHaveLength(0);
      expect(await rows('period_cfdis', missing.cfdi)).toHaveLength(0);
      expect((await rows('incidents', missing.cfdi))[0].status).toBe('open');
      expect(await service.reconcile()).toBe(0);
      expect(await rows('period_cfdis', intact.cfdi)).toHaveLength(1);
      // Restore only this disposable object's original bytes; advance only its fixture retry clock.
      await storage.putStream({
        objectKey: missing.key,
        body: Readable.from(missing.bytes),
        expectedSizeBytes: missing.bytes.length,
      });
      await db.query(
        'UPDATE cfdi_period_reconciliations SET next_attempt_at=clock_timestamp() WHERE cfdi_id=$1',
        [missing.cfdi],
      );
      expect(await service.reconcile()).toBe(1);
      expect(
        (await rows('cfdi_period_reconciliations', missing.cfdi))[0].status,
      ).toBe('resolved');
      expect(await rows('period_cfdis', missing.cfdi)).toHaveLength(1);
      expect(await service.reconcile()).toBe(0);
      expect(await rows('period_cfdis', missing.cfdi)).toHaveLength(1);
      console.info(
        'MONTHLY_LEGACY_ASSERTIONS',
        expect.getState().assertionCalls,
      );
    } finally {
      try {
        for (const key of ownedKeys) {
          keys.assertValid(key);
          await storage.delete(key);
        }
      } finally {
        storage.onApplicationShutdown();
        if (worker?.isInitialized) await worker.destroy();
        if (api?.isInitialized) await api.destroy();
        if (db?.isInitialized) await db.destroy();
        if (admin.isInitialized) {
          assert.match(database, /^test_monthly_[0-9a-f]{12}$/);
          await admin.query(
            'DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)',
          );
          await admin.query('DROP ROLE IF EXISTS "' + login + '"');
          await admin.query('DROP ROLE IF EXISTS "' + workerLogin + '"');
          await admin.destroy();
        }
      }
    }
  }, 120000);
});
