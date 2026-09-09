/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  getDatabaseOptions,
  withRuntimeDatabaseRole,
} from '../../src/config/database.config';
import fiscalConfig from '../../src/config/fiscal-platform.config';
import { seedDatabase } from '../../src/database/seeds/seed-database';
import { FiscalTenantTransactionService } from '../../src/database/rls/fiscal-tenant-transaction.service';
import { FiscalMetricsService } from '../../src/common/observability/fiscal-metrics.service';
import { FiscalEventLogger } from '../../src/common/observability/fiscal-event-logger.service';
import { CorrelationIdService } from '../../src/common/correlation/correlation-id.service';
import { CsrfGuard } from '../../src/common/guards/csrf.guard';
import { AuditService } from '../../src/modules/audit/audit.service';
import { AuditEvent } from '../../src/modules/audit/entities/audit-event.entity';
import { ZipIngestionController } from '../../src/modules/cfdi/controllers/zip-ingestion.controller';
import { XmlIngestionController } from '../../src/modules/cfdi/controllers/xml-ingestion.controller';
import { IngestionQueryController } from '../../src/modules/cfdi/controllers/ingestion-query.controller';
import { CfdiController } from '../../src/modules/cfdi/controllers/cfdi.controller';
import { ZipUploadService } from '../../src/modules/cfdi/services/zip-upload.service';
import { XmlUploadService } from '../../src/modules/cfdi/services/xml-upload.service';
import { IngestionQueryService } from '../../src/modules/cfdi/services/ingestion-query.service';
import { CfdiQueryService } from '../../src/modules/cfdi/services/cfdi-query.service';
import { ManualZipJobHandler } from '../../src/modules/cfdi/workers/manual-zip-job.handler';
import { ManualXmlJobHandler } from '../../src/modules/cfdi/workers/manual-xml-job.handler';
import { ZipWorkerPersistenceService } from '../../src/modules/cfdi/workers/zip-worker-persistence.service';
import { XmlObjectProcessor } from '../../src/modules/cfdi/workers/xml-object.processor';
import { CfdiWorkerPersistenceService } from '../../src/modules/cfdi/workers/cfdi-worker-persistence.service';
import { ZipCleanupService } from '../../src/modules/cfdi/workers/zip-cleanup.service';
import { SaxesCfdiParserAdapter } from '../../src/modules/cfdi-parser';
import { ClientAccountScopeService } from '../../src/modules/client-accounts/client-account-scope.service';
import { ClientAccount } from '../../src/modules/client-accounts/entities/client-account.entity';
import { AccountAssignment } from '../../src/modules/client-accounts/entities/account-assignment.entity';
import { LegalEntity } from '../../src/modules/client-accounts/entities/legal-entity.entity';
import { IngestionIdempotencyRepository } from '../../src/modules/ingestion/services/ingestion-idempotency.repository';
import { IngestionJobRepository } from '../../src/modules/ingestion/services/ingestion-job.repository';
import { IngestionJobRegistry } from '../../src/modules/ingestion/workers/ingestion-job.registry';
import { IngestionWorkerRunner } from '../../src/modules/ingestion/workers/ingestion-worker.runner';
import { S3ObjectStorageAdapter } from '../../src/modules/object-storage/adapters/s3/s3-object-storage.adapter';
import { OpaqueObjectKeyFactory } from '../../src/modules/object-storage/services/opaque-object-key.factory';
import { ClamAvScannerAdapter } from '../../src/modules/malware-scanner/adapters/clamav/clamav-scanner.adapter';
import { RedisWakeupService } from '../../src/modules/redis/redis-wakeup.service';
import { SessionCacheService } from '../../src/modules/redis/session-cache.service';
import { SessionsService } from '../../src/modules/sessions/sessions.service';
import { AuthorizationService } from '../../src/modules/sessions/authorization.service';
import { AuthSession } from '../../src/modules/sessions/entities/auth-session.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { Organization } from '../../src/modules/organizations/entities/organization.entity';
import { Membership } from '../../src/modules/memberships/entities/membership.entity';
import { RolePermission } from '../../src/modules/permissions/entities/role-permission.entity';
import { MembershipPermission } from '../../src/modules/permissions/entities/membership-permission.entity';
import { AuthFactor } from '../../src/modules/auth/entities/auth-factor.entity';
import { makeZip } from '../fixtures/zip-fixture';

function containerEnvironment(name: string): Record<string, string> {
  const environments = JSON.parse(
    execFileSync(
      'docker',
      ['inspect', '--format', '{{json .Config.Env}}', name],
      { encoding: 'utf8', windowsHide: true },
    ),
  ) as string[];
  return Object.fromEntries(
    environments.map((value) => {
      const index = value.indexOf('=');
      return [value.slice(0, index), value.slice(index + 1)];
    }),
  );
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('Phase 2 representative integration: real PostgreSQL, session, MinIO, ClamAV, worker and parser', () => {
  it('preserves mixed results, recovers/retries without fiscal duplication, isolates scope and cleans durable objects', async () => {
    if (process.env.RUN_ZIP_INTEGRATION !== 'true')
      throw new Error(
        'RUN_ZIP_INTEGRATION=true is required; this test creates and removes its own test database and logins',
      );
    Logger.overrideLogger(false);
    const postgres = containerEnvironment('balanz-cfdi-phase0-postgres-1');
    const minio = containerEnvironment('balanz-cfdi-phase0-minio-bootstrap-1');
    const suffix = randomBytes(6).toString('hex');
    const database = `test_cfdi_zip_${suffix}`;
    const loginNames = [`zip_api_${suffix}`, `zip_worker_${suffix}`];
    const adminOptions = getDatabaseOptions({
      host: '127.0.0.1',
      port: 55432,
      username: postgres.POSTGRES_USER,
      password: postgres.POSTGRES_PASSWORD,
      name: postgres.POSTGRES_DB,
      logging: false,
      connectionTimeoutMs: 3000,
    });
    if (adminOptions.type !== 'postgres')
      throw new Error('ZIP integration requires PostgreSQL');
    const admin = new DataSource({
      ...adminOptions,
      entities: [],
      migrations: [],
    });
    let db: DataSource | undefined;
    let api: DataSource | undefined;
    let worker: DataSource | undefined;
    let app: INestApplication | undefined;
    let runner: IngestionWorkerRunner | undefined;
    const keys = new OpaqueObjectKeyFactory(`phase2-${suffix}/objects`);
    const storage = new S3ObjectStorageAdapter(
      {
        driver: 's3',
        endpoint: 'http://127.0.0.1:59000',
        allowInsecureEndpoint: true,
        forcePathStyle: true,
        region: 'us-east-2',
        bucket: 'balanz-cfdi-phase0-test',
        maxBytes: 50 * 1024 * 1024,
        requestTimeoutMs: 10000,
        credentials: {
          accessKeyId: minio.MINIO_APP_USER,
          secretAccessKey: minio.MINIO_APP_PASSWORD,
        },
        serverSideEncryption: 'AES256',
        signedUrlTtlSeconds: 60,
      },
      keys,
    );
    let assertions = 0;
    const check = (condition: unknown, label: string) => {
      assertions++;
      if (!condition) throw new Error(`ZIP integration assertion: ${label}`);
    };
    try {
      await admin.initialize();
      await admin.query(`CREATE DATABASE "${database}"`);
      db = new DataSource({ ...adminOptions, database });
      await db.initialize();
      await db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
      await db.runMigrations({ transaction: 'all' });
      // Exercise the exact CI gate on this disposable, fully migrated database.
      // Its transaction rolls back; no shared environment or Vault is used.
      const lifecycleOutput = execFileSync(
        process.execPath,
        [
          '-r',
          'ts-node/register/transpile-only',
          'test/validate-migration-lifecycle.ts',
        ],
        {
          cwd: resolve(__dirname, '../..'),
          windowsHide: true,
          encoding: 'utf8',
          timeout: 60000,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            SECRETS_ENABLED: 'false',
            DB_HOST: '127.0.0.1',
            DB_PORT: '55432',
            DB_USERNAME: postgres.POSTGRES_USER,
            DB_PASSWORD: postgres.POSTGRES_PASSWORD,
            DB_DATABASE: database,
            DB_LOGGING: 'false',
            CFDI_PHASE0_USE_TEST_DATABASE: 'true',
            CFDI_PHASE0_TEST_DATABASE: database,
          },
        },
      );
      check(
        lifecycleOutput.includes('counterReconciliationExplain') &&
          lifecycleOutput.includes('PASSED'),
        'current CI migration lifecycle gate',
      );
      await seedDatabase(db);
      const runtime: DataSource[] = [];
      for (const [index, role] of ['balanz_api', 'balanz_worker'].entries()) {
        const password = randomBytes(24).toString('hex');
        await admin.query(
          `CREATE ROLE "${loginNames[index]}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
        );
        await admin.query(`GRANT ${role} TO "${loginNames[index]}"`);
        const source = new DataSource(
          withRuntimeDatabaseRole(
            {
              ...adminOptions,
              database,
              username: loginNames[index],
              password,
              migrations: [],
            },
            role as 'balanz_api' | 'balanz_worker',
          ),
        );
        await source.initialize();
        runtime.push(source);
      }
      [api, worker] = runtime;
      const fiscal = fiscalConfig();
      fiscal.storage.driver = 's3';
      fiscal.storage.s3.bucket = 'balanz-cfdi-phase0-test';
      fiscal.redisWakeup.enabled = false;
      fiscal.worker.pollIntervalMs = 100;
      fiscal.worker.concurrency = 1;
      const config = new ConfigService({
        fiscalPlatform: fiscal,
        app: { globalPrefix: 'api/v1', corsOrigins: ['http://localhost:5181'] },
        cookies: { sessionName: 'zip_session' },
        redis: { enabled: false },
      });
      const metrics = new FiscalMetricsService();
      const correlation = new CorrelationIdService();
      const wakeup = new RedisWakeupService(null, config, metrics);
      const apiTransactions = new FiscalTenantTransactionService(api);
      const workerTransactions = new FiscalTenantTransactionService(worker);
      const accounts = new ClientAccountScopeService(
        api.getRepository(ClientAccount),
        api.getRepository(AccountAssignment),
      );
      const idempotency = new IngestionIdempotencyRepository(
        apiTransactions,
        wakeup,
        metrics,
        keys,
        config,
      );
      const jobs = new IngestionJobRepository(workerTransactions, config);
      const apiJobs = new IngestionJobRepository(apiTransactions, config);
      const zipUploads = new ZipUploadService(
        apiTransactions,
        accounts,
        idempotency,
        keys,
        storage,
        config,
      );
      const queries = new IngestionQueryService(
        apiTransactions,
        accounts,
        apiJobs,
        idempotency,
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
      const sessions = new SessionsService(
        api.getRepository(AuthSession),
        config,
        api,
        authorization,
        new SessionCacheService(null, config),
      );
      const fixtureXml = readFileSync(
        resolve(__dirname, '../fixtures/cfdi/valid-ingreso.xml'),
      );
      const parsed = await new SaxesCfdiParserAdapter().parse(
        Readable.from([fixtureXml]),
      );
      const scope = await createScope(db, suffix, parsed.document.issuer.rfc);
      const other = await createScope(
        db,
        `${suffix}b`,
        parsed.document.issuer.rfc,
      );
      const session = await sessions.create({
        userId: scope.userId,
        organizationId: scope.organizationId,
        membershipId: scope.membershipId,
      });
      const otherSession = await sessions.create({
        userId: other.userId,
        organizationId: other.organizationId,
        membershipId: other.membershipId,
      });
      const testModule = await Test.createTestingModule({
        controllers: [
          ZipIngestionController,
          XmlIngestionController,
          IngestionQueryController,
          CfdiController,
        ],
        providers: [
          { provide: ConfigService, useValue: config },
          { provide: SessionsService, useValue: sessions },
          {
            provide: AuditService,
            useValue: new AuditService(
              api.getRepository(AuditEvent),
              correlation,
            ),
          },
          { provide: ZipUploadService, useValue: zipUploads },
          { provide: IngestionQueryService, useValue: queries },
          {
            provide: XmlUploadService,
            useValue: new XmlUploadService(
              api.getRepository(LegalEntity),
              accounts,
              idempotency,
              keys,
              storage,
              config,
            ),
          },
          {
            provide: CfdiQueryService,
            useValue: new CfdiQueryService(
              apiTransactions,
              accounts,
              storage,
              config,
            ),
          },
        ],
      }).compile();
      app = testModule.createNestApplication({ logger: false });
      app.setGlobalPrefix('api/v1');
      app.use(cookieParser());
      app.use(
        (req: { correlationId: string }, _res: unknown, next: () => void) => {
          req.correlationId = randomUUID();
          next();
        },
      );
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      app.useGlobalGuards(new CsrfGuard(config));
      await app.init();
      const http = request(
        app.getHttpServer() as Parameters<typeof request>[0],
      );
      const cookie = `zip_session=${session.rawToken}`;
      const otherCookie = `zip_session=${otherSession.rawToken}`;
      const initPath = `/api/v1/legal-entities/${scope.legalEntityId}/ingestions/zip/init`;
      const bytes = makeZip([
        { name: 'uno.xml', body: fixtureXml, method: 8 },
        { name: 'duplicado.xml', body: fixtureXml, method: 8 },
        { name: 'invalido.xml', body: Buffer.from('<x>') },
        ...Array.from({ length: 27 }, (_, i) => ({
          name: `nota-${i}.txt`,
          body: Buffer.from('benign'),
        })),
      ]);
      const dto = {
        filename: 'prueba.zip',
        mimeType: 'application/zip',
        sizeBytes: bytes.length,
        sha256: sha(bytes),
      };
      const initKey = randomUUID();
      const post = (
        path: string,
        body: object = {},
        key?: string,
        auth = cookie,
      ) => {
        const call = http
          .post(path)
          .set('Cookie', auth)
          .set('Origin', 'http://localhost:5181');
        if (key) call.set('Idempotency-Key', key);
        return call.send(body);
      };
      check((await post(initPath, dto)).status === 400, 'idempotency required');
      check(
        (await post(initPath, dto, randomUUID(), otherCookie)).status === 404,
        'init cross tenant denied',
      );
      const init = await post(initPath, dto, initKey);
      check(
        init.status === 201,
        `init HTTP ${init.status}: ${String(init.body.code)}`,
      );
      const initAgain = await post(initPath, dto, initKey);
      check(
        initAgain.body.uploadId === init.body.uploadId,
        'idempotent init IDs',
      );
      check(
        (await db.query(`SELECT count(*)::int AS count FROM ingestion_jobs`))[0]
          .count === 0,
        'init creates no job',
      );
      const confirmPath = `/api/v1/ingestion-uploads/${init.body.uploadId}/zip/confirm`;
      const confirmKey = `zip-confirm:${init.body.uploadId}`;
      check(
        (await post(confirmPath, {}, confirmKey)).status === 409,
        'missing object confirm rejected',
      );
      check(
        (await post(confirmPath, {}, confirmKey, otherCookie)).status === 404,
        'confirm cross tenant denied',
      );
      const bad = await fetch(init.body.upload.url as string, {
        method: 'PUT',
        headers: init.body.upload.headers as Record<string, string>,
        body: Buffer.alloc(bytes.length, 0x61),
      });
      check(bad.status >= 400, 'signed SHA256 binds exact bytes');
      const put = await fetch(init.body.upload.url as string, {
        method: 'PUT',
        headers: init.body.upload.headers as Record<string, string>,
        body: new Uint8Array(bytes),
      });
      check(put.status === 200, `signed PUT HTTP ${put.status}`);
      const overwrite = await fetch(init.body.upload.url as string, {
        method: 'PUT',
        headers: init.body.upload.headers as Record<string, string>,
        body: new Uint8Array(bytes),
      });
      check(overwrite.status === 412, 'signed PUT immutable');
      // Simulate an API crash, then prove atomic takeover and stale-owner fencing
      // using the restricted API login and actual PostgreSQL state/version.
      const abandoned = await idempotency.claimUploadReceiver(
        scope,
        init.body.uploadId as string,
        'manual_zip',
      );
      check(abandoned.outcome === 'claimed', 'ZIP verification claim acquired');
      await db.query(
        `UPDATE ingestion_uploads SET updated_at=clock_timestamp()-interval '10 minutes' WHERE id=$1`,
        [init.body.uploadId],
      );
      const recovered = await idempotency.claimUploadReceiver(
        scope,
        init.body.uploadId as string,
        'manual_zip',
      );
      check(
        recovered.outcome === 'claimed' &&
          recovered.value.receiverVersion! > abandoned.value.receiverVersion!,
        'expired verification claim recovered with a new fence',
      );
      check(
        (await idempotency.renewUploadReceiver(
          scope,
          init.body.uploadId as string,
          abandoned.value.receiverVersion!,
          'manual_zip',
        )) === null,
        'stale owner cannot renew',
      );
      await idempotency.releaseZipConfirmation(
        scope,
        init.body.uploadId as string,
        abandoned.value.receiverVersion!,
      );
      check(
        (
          await idempotency.claimUploadReceiver(
            scope,
            init.body.uploadId as string,
            'manual_zip',
          )
        ).outcome === 'busy',
        'stale owner cannot release the current claim',
      );
      await expect(
        idempotency.confirmUpload({
          scope,
          uploadId: init.body.uploadId as string,
          idempotencyKey: confirmKey,
          requestFingerprint: sha(Buffer.from('stale')),
          idempotencyExpiresAt: new Date(Date.now() + 60000),
          actualSha256: sha(bytes),
          actualSizeBytes: String(bytes.length),
          correlationId: randomUUID(),
          receiverVersion: abandoned.value.receiverVersion!,
        }),
      ).rejects.toMatchObject({ code: 'UPLOAD_CONFIRM_IN_PROGRESS' });
      await idempotency.releaseZipConfirmation(
        scope,
        init.body.uploadId as string,
        recovered.value.receiverVersion!,
      );

      let entered!: () => void, release!: () => void;
      const enteredStorage = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const realHead = storage.head.bind(
        storage,
      ) as S3ObjectStorageAdapter['head'];
      const headSpy = jest
        .spyOn(storage, 'head')
        .mockImplementationOnce(async (key) => {
          entered();
          await gate;
          return realHead(key);
        });
      const readSpy = jest.spyOn(storage, 'openReadStream');
      const firstConfirm = post(confirmPath, {}, confirmKey).then(
        (response) => response,
      );
      let confirm: Awaited<typeof firstConfirm>;
      try {
        await enteredStorage;
        const concurrent = await post(confirmPath, {}, confirmKey);
        check(
          concurrent.status === 409 &&
            concurrent.body.code === 'UPLOAD_CONFIRM_IN_PROGRESS',
          'concurrent confirm recovers instead of hashing twice',
        );
        check(
          headSpy.mock.calls.length === 1 && readSpy.mock.calls.length === 0,
          'storage belongs to one durable verifier',
        );
      } finally {
        release();
      }
      try {
        confirm = await firstConfirm;
        check(
          readSpy.mock.calls.length === 1,
          'one streamed checksum verification',
        );
      } finally {
        headSpy.mockRestore();
        readSpy.mockRestore();
      }
      check(
        confirm.status === 202,
        `confirm HTTP ${confirm.status}: ${String(confirm.body.code)}`,
      );
      const confirmedAgain = await post(confirmPath, {}, confirmKey);
      check(
        confirmedAgain.body.jobId === confirm.body.jobId,
        'idempotent confirm IDs',
      );
      check(
        (await post(confirmPath, {}, randomUUID())).status === 409,
        'second confirm key cannot create job',
      );
      const xmlPersistence = new CfdiWorkerPersistenceService(
        workerTransactions,
        config,
      );
      const zipPersistence = new ZipWorkerPersistenceService(
        workerTransactions,
        keys,
        config,
      );
      const scanner = new ClamAvScannerAdapter({
        driver: 'clamav',
        host: '127.0.0.1',
        port: 53310,
        connectTimeoutMs: 2000,
        scanTimeoutMs: 30000,
        maxBytes: 50 * 1024 * 1024,
      });
      check((await scanner.health()).status === 'up', 'real ClamAV healthy');
      const parser = new SaxesCfdiParserAdapter();
      const processor = new XmlObjectProcessor(
        storage,
        scanner,
        parser,
        xmlPersistence,
      );
      const zipHandler = new ManualZipJobHandler(
        storage,
        scanner,
        zipPersistence,
        xmlPersistence,
        processor,
        metrics,
      );
      const cleanup = new ZipCleanupService(
        workerTransactions,
        storage,
        metrics,
      );
      runner = new IngestionWorkerRunner(
        config,
        jobs,
        new IngestionJobRegistry([
          zipHandler,
          new ManualXmlJobHandler(xmlPersistence, processor),
        ]),
        wakeup,
        correlation,
        metrics,
        new FiscalEventLogger(),
        cleanup,
      );
      runner.onApplicationBootstrap();
      const terminal = await waitTerminal(db, confirm.body.jobId as string);
      check(
        terminal.status === 'completed_with_issues',
        `mixed package terminal ${String(terminal.status)} / ${String(terminal.last_error_code)}`,
      );
      check(
        terminal.total_items === 30 &&
          terminal.incorporated_items === 1 &&
          terminal.duplicate_items === 1 &&
          terminal.invalid_items === 1 &&
          terminal.unsupported_items === 27,
        'durable mixed counters',
      );
      const jobPath = `/api/v1/ingestions/${confirm.body.jobId}`;
      const page1 = await http
        .get(`${jobPath}/items?limit=25&direction=asc&page=1`)
        .set('Cookie', cookie);
      const page2 = await http
        .get(`${jobPath}/items?limit=25&direction=asc&page=2`)
        .set('Cookie', cookie);
      check(
        page1.status === 200 &&
          page1.body.items.length === 25 &&
          page2.body.items.length === 5,
        'paginated entries',
      );
      check(
        page1.body.items[0].ordinal === 1 &&
          page2.body.items[0].ordinal === 26 &&
          page2.body.meta.total === 30,
        'stable ordinals and total',
      );
      check(
        (await http.get(jobPath).set('Cookie', otherCookie)).status === 404,
        'status cross tenant denied',
      );
      const list = await http
        .get(`/api/v1/legal-entities/${scope.legalEntityId}/cfdis`)
        .set('Cookie', cookie);
      check(
        list.status === 200 && list.body.items.length === 1,
        'existing CFDI list',
      );
      const cfdiId = page1.body.items[0].cfdiId as string;
      check(
        (await http.get(`/api/v1/cfdis/${cfdiId}`).set('Cookie', cookie))
          .status === 200,
        'existing CFDI detail',
      );
      const retryKey = randomUUID();
      const retry = await post(`${jobPath}/retry`, {}, retryKey);
      check(
        retry.status === 202 && retry.body.jobId !== confirm.body.jobId,
        'retry new durable job',
      );
      check(
        (await post(`${jobPath}/retry`, {}, retryKey)).body.jobId ===
          retry.body.jobId,
        'retry idempotent',
      );
      const retryTerminal = await waitTerminal(db, retry.body.jobId as string);
      check(
        retryTerminal.duplicate_items === 2 &&
          retryTerminal.incorporated_items === 0,
        'retry fiscal dedupe',
      );
      const old = (
        await db.query(`SELECT * FROM ingestion_jobs WHERE id=$1`, [
          confirm.body.jobId,
        ])
      )[0];
      check(old.version === terminal.version, 'retry preserves terminal job');
      const xmlUpload = await http
        .post(`/api/v1/legal-entities/${scope.legalEntityId}/ingestions/xml`)
        .set('Origin', 'http://localhost:5181')
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .attach('file', fixtureXml, {
          filename: 'original.xml',
          contentType: 'application/xml',
        });
      check(xmlUpload.status === 202, 'manual XML admission regression');
      const xmlTerminal = await waitTerminal(
        db,
        xmlUpload.body.jobId as string,
      );
      check(
        xmlTerminal.duplicate_items === 1,
        'shared XML processor preserves dedupe',
      );
      await runner.onApplicationShutdown();
      runner = undefined;
      // The same production handler replays already terminal items after an
      // interrupted automatic execution without creating new observations.
      const cancelledRetry = await post(`${jobPath}/retry`, {}, randomUUID());
      check(cancelledRetry.status === 202, 'new cancel candidate');
      const claim = await jobs.claimNext(`zip-qa:${suffix}`, ['manual_zip']);
      check(
        claim?.jobId === cancelledRetry.body.jobId,
        'real claim selects ZIP',
      );
      await db.query(
        `UPDATE stored_objects SET retention_until=clock_timestamp()-interval '1 day' WHERE id=$1`,
        [claim!.rootObjectId],
      );
      await cleanup.reconcile();
      check(
        (
          await db.query(
            `SELECT cleanup_requested_at FROM stored_objects WHERE id=$1`,
            [claim!.rootObjectId],
          )
        )[0].cleanup_requested_at === null,
        'active retry protects expired root from cleanup',
      );
      check(
        (await post(`/api/v1/ingestions/${claim!.jobId}/cancel`)).status ===
          202,
        'cancel admitted',
      );
      await expect(
        zipHandler.handle(claim!, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'ZIP_CANCELLED' });
      check(
        await jobs.complete(claim!, 'cancelled'),
        'cancel converges with fence',
      );
      // Garbage collection preserves the original CFDI while deleting due
      // duplicate copies through the durable cleanup claim and normal RLS.
      await db.query(
        `UPDATE stored_objects SET retention_until=clock_timestamp()-interval '1 day' WHERE kind='extracted_xml' AND quarantine_reason_code='CFDI_DUPLICATE'`,
      );
      await cleanup.reconcile();
      check(
        (
          await db.query(
            `SELECT count(*)::int AS count FROM stored_objects WHERE kind='extracted_xml' AND lifecycle_state='deleted'`,
          )
        )[0].count >= 1,
        'durable duplicate cleanup',
      );
      check(
        (
          await db.query(
            `SELECT lifecycle_state FROM stored_objects WHERE id=(SELECT source_object_id FROM cfdis WHERE id=$1)`,
            [cfdiId],
          )
        )[0].lifecycle_state === 'available',
        'original survives cleanup',
      );
      const isolation = await apiTransactions.run(
        {
          organizationId: other.organizationId,
          membershipId: other.membershipId,
        },
        (manager) =>
          manager.query(
            `SELECT id FROM ingestion_items WHERE ingestion_job_id=$1`,
            [confirm.body.jobId],
          ),
      );
      check(isolation.length === 0, 'new item columns retain RLS isolation');
      const roles = await api.query(
        `SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`,
      );
      check(
        roles[0].role === 'balanz_api' &&
          !roles[0].rolsuper &&
          !roles[0].rolbypassrls,
        'real restricted API login',
      );
      console.log(
        JSON.stringify({
          phase: 'PHASE_2_ZIP',
          assertions,
          database: 'isolated test database',
          session: 'real opaque session',
          storage: 'real MinIO signed PUT + immutable ranges',
          scanner: 'real ClamAV INSTREAM',
          worker: 'production runner and handlers',
          mixed: {
            total: 30,
            incorporated: 1,
            duplicate: 1,
            invalid: 1,
            unsupported: 27,
          },
          retry: 'new job; old version unchanged; no extra CFDI',
          cleanup: 'duplicates deleted, original preserved',
        }),
      );
    } finally {
      await runner?.onApplicationShutdown();
      await app?.close();
      if (db?.isInitialized) {
        const objects = await db
          .query<
            Array<{ object_key: string }>
          >(`SELECT object_key FROM stored_objects`)
          .catch(() => []);
        for (const object of objects) await storage.delete(object.object_key);
      }
      storage.onApplicationShutdown();
      for (const source of [api, worker, db])
        if (source?.isInitialized) await source.destroy();
      if (admin.isInitialized) {
        assertTestDatabase(database);
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        for (const name of loginNames)
          await admin.query(`DROP ROLE IF EXISTS "${name}"`);
        await admin.destroy();
      }
    }
  }, 240000);
});

function assertTestDatabase(database: string) {
  if (!/^test_cfdi_zip_[0-9a-f]{12}$/.test(database))
    throw new Error('Unsafe test cleanup target');
}

async function createScope(db: DataSource, suffix: string, rfc: string) {
  const scope = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    membershipId: randomUUID(),
    clientAccountId: randomUUID(),
    legalEntityId: randomUUID(),
  };
  await db.transaction(async (manager) => {
    const [role] = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM roles WHERE key='accountant'`,
    );
    await manager.query(
      `INSERT INTO users(id,first_name,last_name,email,status,password_hash) VALUES($1,'QA','ZIP',$2,'active','synthetic-no-login')`,
      [scope.userId, `zip-${suffix}@example.invalid`],
    );
    await manager.query(
      `INSERT INTO organizations(id,name,slug,owner_user_id,status,timezone) VALUES($1,'QA ZIP',$2,$3,'active','America/Mexico_City')`,
      [scope.organizationId, `zip-${suffix}`, scope.userId],
    );
    await manager.query(
      `INSERT INTO memberships(id,organization_id,user_id,role_id,status,joined_at) VALUES($1,$2,$3,$4,'active',clock_timestamp())`,
      [scope.membershipId, scope.organizationId, scope.userId, role.id],
    );
    await manager.query(
      `INSERT INTO client_accounts(id,organization_id,name,code,status) VALUES($1,$2,'QA ZIP',$3,'active')`,
      [scope.clientAccountId, scope.organizationId, `ZIP-${suffix}`],
    );
    await manager.query(
      `INSERT INTO legal_entities(id,organization_id,client_account_id,rfc,legal_name,status) VALUES($1,$2,$3,$4,'QA ZIP','active')`,
      [scope.legalEntityId, scope.organizationId, scope.clientAccountId, rfc],
    );
    const year = randomUUID();
    await manager.query(
      `INSERT INTO fiscal_years(id,organization_id,client_account_id,legal_entity_id,year,status) VALUES($1,$2,$3,$4,2026,'active')`,
      [year, scope.organizationId, scope.clientAccountId, scope.legalEntityId],
    );
    await manager.query(
      `INSERT INTO periods(id,organization_id,client_account_id,legal_entity_id,fiscal_year_id,month,status) VALUES($1,$2,$3,$4,$5,8,'not_started')`,
      [
        randomUUID(),
        scope.organizationId,
        scope.clientAccountId,
        scope.legalEntityId,
        year,
      ],
    );
  });
  return scope;
}
async function waitTerminal(
  db: DataSource,
  jobId: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const [row] = await db.query<Array<Record<string, unknown>>>(
      `SELECT * FROM ingestion_jobs WHERE id=$1`,
      [jobId],
    );
    if (
      [
        'completed',
        'completed_with_issues',
        'cancelled',
        'failed_final',
      ].includes(String(row.status))
    )
      return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const [row] = await db.query<
    Array<{ status: string; last_error_code: string }>
  >(`SELECT status,last_error_code FROM ingestion_jobs WHERE id=$1`, [jobId]);
  throw new Error(`ZIP job timed out: ${row.status}/${row.last_error_code}`);
}
