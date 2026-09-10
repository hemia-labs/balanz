import { ZipCleanupService } from '../../src/modules/cfdi/workers/zip-cleanup.service';
import { METADATA_HEADER } from '../../src/modules/sat-download/metadata-parser';
import { readFileSync } from 'node:fs';
import { FiscalMetricsService } from '../../src/common/observability/fiscal-metrics.service';
import { ClamAvScannerAdapter } from '../../src/modules/malware-scanner/adapters/clamav/clamav-scanner.adapter';
import { SaxesCfdiParserAdapter } from '../../src/modules/cfdi-parser';
import { CfdiWorkerPersistenceService } from '../../src/modules/cfdi/workers/cfdi-worker-persistence.service';
import { ZipWorkerPersistenceService } from '../../src/modules/cfdi/workers/zip-worker-persistence.service';
import { XmlObjectProcessor } from '../../src/modules/cfdi/workers/xml-object.processor';
import { IngestionJobRepository } from '../../src/modules/ingestion/services/ingestion-job.repository';
import { SatPackageJobHandler } from '../../src/modules/sat-download/sat-package.handler';
import { SatMetadataProcessor } from '../../src/modules/sat-download/sat-metadata.processor';
import { createServer, type Server } from 'node:http';
import { SignedXml } from 'xml-crypto';
import { X509Certificate } from 'node:crypto';
import { SatService } from '../../src/modules/sat-download/sat.service';
import { SatWorker } from '../../src/modules/sat-download/sat-worker';
import { SatAdapter } from '../../src/modules/sat-download/sat-adapter';
import { SOAP, SAT, AUTH } from '../../src/modules/sat-download/sat-contract';
import { makeZip } from '../fixtures/zip-fixture';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('Phase 4 real isolated PostgreSQL, Vault and private MinIO', () => {
  it('signs, reauthorizes, downloads, ingests mixed XML and preserves uncertain submission', async () => {
    if (process.env.RUN_EFIRMA_INTEGRATION !== 'true')
      throw new Error(
        'Opt in with RUN_EFIRMA_INTEGRATION=true; this creates only disposable synthetic QA resources.',
      );
    const suffix = randomBytes(6).toString('hex');
    const database = `test_sat_${suffix}`;
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
    let satServer: Server | undefined;
    const saved = {
      SAT_ENABLED: process.env.SAT_ENABLED,
      SAT_QA_ISOLATED: process.env.SAT_QA_ISOLATED,
      EFIRMA_ENABLED: process.env.EFIRMA_ENABLED,
    };
    process.env.SAT_ENABLED = 'true';
    process.env.SAT_QA_ISOLATED = 'true';
    process.env.EFIRMA_ENABLED = 'true';
    let count = 0;
    const check = (condition: unknown, label: string) => {
      count++;
      if (!condition) throw new Error(`Phase 4 assertion: ${label}`);
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
        maxBytes: 50 * 1024 * 1024,
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
        new VaultCustodyAdapter(apiRepository.config.vault!),
      );
      const consumption = new EfirmaConsumerService(
        workerRepository,
        storage,
        new VaultCustodyAdapter(workerRepository.config.vault!),
      );
      const cleaner = new EfirmaCleanupService(
        workerRepository,
        storage,
        new VaultCustodyAdapter(workerRepository.config.cleanupVault!),
      );
      const tenant: SessionAuthorizationContext = {
        userId: randomUUID(),
        sessionId: randomUUID(),
        organizationId: randomUUID(),
        membershipId: randomUUID(),
        role: 'owner',
        permissions: ['credentials.manage', 'sat.download'],
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

      let submissions = 0,
        verifications = 0,
        downloads = 0,
        signatures = 0,
        loseSubmission = false;
      let loseFenceFor: string | undefined;
      let metadataMode = false,
        failDownload = false;
      const cert = new X509Certificate(fixture.certificate);
      let zip = makeZip([
        {
          name: 'valid.xml',
          body: readFileSync(
            join(__dirname, '../fixtures/cfdi/valid-ingreso.xml'),
          ),
        },
        { name: 'invalid.xml', body: Buffer.from('<invalid/>') },
        { name: 'readme.txt', body: Buffer.from('benign') },
      ]);
      satServer = createServer((req, res) => {
        void (async () => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const c of req) {
            bytes += c.length;
            if (bytes > 32768) throw new Error('request bound');
            chunks.push(c as Buffer);
          }
          const xml = Buffer.concat(chunks).toString('utf8');
          const signature = xml.match(/<Signature[\s\S]*?<\/Signature>/)?.[0];
          if (!signature) throw new Error('signature missing');
          const auth = req.url === '/authentication';
          if (auth && loseFenceFor) {
            await db!.query(
              "UPDATE sat_download_jobs SET fence=fence+1,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
              [loseFenceFor],
            );
            loseFenceFor = undefined;
          }
          const element =
            req.url === '/download' ? 'peticionDescarga' : 'solicitud';
          const payload = auth
            ? xml
            : xml.slice(
                xml.indexOf('<' + element + ' '),
                xml.indexOf('</' + element + '>') + element.length + 3,
              );
          const verifier = new SignedXml({
            publicCert: cert.toString(),
            getCertFromKeyInfo: () => null,
            ...(auth ? { idMode: 'wssecurity' as const } : {}),
          });
          verifier.loadSignature(signature);
          if (
            !verifier.checkSignature(payload) ||
            verifier.getSignedReferences().length !== 1
          )
            throw new Error('invalid signed reference');
          if (
            !auth &&
            !verifier.getSignedReferences()[0].includes('AAA010101AAA')
          )
            throw new Error('wrong signed entity');
          signatures++;
          if (
            !auth &&
            req.headers.authorization !== 'WRAP access_token="controlled-token"'
          )
            throw new Error('token missing');
          let body = '';
          if (auth)
            body =
              '<AutenticaResponse xmlns="' +
              AUTH +
              '"><AutenticaResult>controlled-token</AutenticaResult></AutenticaResponse>';
          else if (req.url === '/request') {
            if (
              !verifier
                .getSignedReferences()[0]
                .includes('FechaInicial="2026-01-01T00:00:00"')
            )
              throw new Error('wrong signed local date');
            submissions++;
            if (loseSubmission) {
              req.socket.destroy();
              return;
            }
            body =
              '<SolicitaDescargaEmitidosResponse xmlns="' +
              SAT +
              '"><SolicitaDescargaEmitidosResult CodEstatus="5000" IdSolicitud="CONTROLLED-FOLIO"/></SolicitaDescargaEmitidosResponse>';
          } else if (req.url === '/verification') {
            verifications++;
            body =
              '<VerificaSolicitudDescargaResponse xmlns="' +
              SAT +
              '"><VerificaSolicitudDescargaResult CodEstatus="5000" EstadoSolicitud="' +
              (verifications === 1 ? '2' : '3') +
              '" CodigoEstadoSolicitud="5000" NumeroCFDIs="' +
              (verifications === 1 ? '0' : metadataMode ? '1' : '2') +
              '">' +
              (verifications === 1
                ? ''
                : '<IdsPaquetes>CONTROLLED-PACKAGE</IdsPaquetes>' +
                  (metadataMode
                    ? ''
                    : '<IdsPaquetes>CONTROLLED-PACKAGE-2</IdsPaquetes>')) +
              '</VerificaSolicitudDescargaResult></VerificaSolicitudDescargaResponse>';
          } else if (req.url === '/download') {
            downloads++;
            if (failDownload) {
              res.statusCode = 503;
              res.end('controlled unavailable');
              return;
            }
            res.setHeader('Content-Type', 'text/xml');
            const reply =
              '<s:Envelope xmlns:s="' +
              SOAP +
              '"><s:Header><respuesta xmlns="' +
              SAT +
              '" CodEstatus="5000"/></s:Header><s:Body><RespuestaDescargaMasivaTercerosSalida xmlns="' +
              SAT +
              '"><Paquete>' +
              zip.toString('base64') +
              '</Paquete></RespuestaDescargaMasivaTercerosSalida></s:Body></s:Envelope>';
            for (let i = 0; i < reply.length; i += 7) {
              if (!res.write(reply.slice(i, i + 7)))
                await new Promise<void>((r) => res.once('drain', r));
            }
            res.end();
            return;
          } else throw new Error('unexpected operation');
          res.setHeader('Content-Type', 'text/xml');
          res.end(
            '<s:Envelope xmlns:s="' +
              SOAP +
              '"><s:Body>' +
              body +
              '</s:Body></s:Envelope>',
          );
        })().catch(() => {
          res.statusCode = 400;
          res.end('controlled contract rejected');
        });
      });
      await new Promise<void>((r) => satServer!.listen(0, '127.0.0.1', r));
      const satAddress = satServer.address();
      if (!satAddress || typeof satAddress === 'string')
        throw new Error('server address');
      const url = 'http://127.0.0.1:' + satAddress.port;
      const adapter = new SatAdapter({
        isolated: true,
        authentication: url + '/authentication',
        request: url + '/request',
        verification: url + '/verification',
        download: url + '/download',
      });
      const service = new SatService(apiRepository, preparation);
      const satWorker = new SatWorker(
        workerRepository,
        consumption,
        storage,
        configuration(true),
        adapter,
      );
      const filters = {
        legalEntityId: entity,
        direction: 'issued' as const,
        contentType: 'xml' as const,
        dateFrom: '2026-01-01T00:00:00',
        dateTo: '2026-01-02T00:00:00',
        documentType: 'I' as const,
        documentStatus: 'active' as const,
      };
      const requestKey = randomUUID();
      const job = await service.create(
        tenant,
        filters,
        requestKey,
        randomUUID(),
      );
      check(
        (await service.create(tenant, filters, requestKey, randomUUID())).id ===
          job.id,
        'idempotent logical process',
      );
      const authorize = async (id: string) => {
        const binding = await service.binding(tenant, id);
        await db!.query(
          'UPDATE auth_sessions SET reauthenticated_at=clock_timestamp() WHERE id=$1',
          [tenant.sessionId],
        );
        const grant = await apiRepository.issueGrant(
          tenant,
          entity,
          randomUUID(),
          binding,
        );
        const ready = await service.prepare(
          tenant,
          id,
          randomUUID(),
          makeInput(grant.grant),
          randomUUID(),
        );
        check(
          ready.status === 'ready',
          'real wrapping/Transit custody prepared',
        );
        return ready;
      };
      const first = await authorize(job.id);
      await Promise.all([
        satWorker.runJob(tenant.organizationId!, job.id),
        satWorker.runJob(tenant.organizationId!, job.id),
      ]);
      check(
        (await service.get(tenant, job.id)).status === 'waiting_sat',
        'accepted request preserved: ' +
          JSON.stringify(
            await db.query(
              'SELECT status,error_code FROM sat_download_jobs WHERE id=$1',
              [job.id],
            ),
          ),
      );
      check(submissions === 1, 'one fiscal submission');
      await expect(
        consumption.withCredential(
          tenant.organizationId!,
          first.id,
          () => Promise.resolve(),
          { purpose: 'sat.submit', jobId: job.id, filterVersion: 1 },
        ),
      ).rejects.toThrow();
      check(true, 'unwrap single use');
      await authorize(job.id);
      await satWorker.runJob(tenant.organizationId!, job.id);
      check(
        (await service.get(tenant, job.id)).status === 'waiting_sat',
        'normal SAT wait',
      );
      check(
        (
          await db.query(
            'SELECT technical_retries FROM sat_download_jobs WHERE id=$1',
            [job.id],
          )
        )[0].technical_retries === 0,
        'waiting does not consume retry',
      );
      await authorize(job.id);
      await satWorker.runJob(tenant.organizationId!, job.id);
      const result = await service.get(tenant, job.id);
      check(
        result.status === 'processing_local',
        'download creates local processing: ' +
          JSON.stringify(
            await db.query(
              'SELECT status,error_code FROM sat_download_jobs WHERE id=$1',
              [job.id],
            ),
          ),
      );
      check(
        downloads === 2 && submissions === 1,
        'reauthorization never resubmits',
      );
      const packages = await service.packages(tenant, job.id, 0, 100);
      check(
        packages.items.length === 2 && !!packages.items[0].ingestion_job_id,
        'durable sat_package without manual upload: ' +
          JSON.stringify(
            await db.query(
              'SELECT status,error_code,download_attempts FROM sat_packages',
            ),
          ),
      );
      check(
        (
          await db.query(
            'SELECT upload_id,source_type FROM ingestion_jobs WHERE id=$1',
            [packages.items[0].ingestion_job_id],
          )
        )[0].upload_id === null,
        'no fictitious manual upload',
      );
      await satWorker.runJob(tenant.organizationId!, job.id);
      check(downloads === 2, 'restart reuses intact package');
      const transactions = new FiscalTenantTransactionService(runtimes[1]);
      const ingestion = new IngestionJobRepository(
        transactions,
        configuration(true),
      );
      const xmlPersistence = new CfdiWorkerPersistenceService(
          transactions,
          configuration(true),
        ),
        zipPersistence = new ZipWorkerPersistenceService(
          transactions,
          new OpaqueObjectKeyFactory(),
          configuration(true),
        );
      const scanner = new ClamAvScannerAdapter({
        driver: 'clamav',
        host: '127.0.0.1',
        port: 53310,
        connectTimeoutMs: 2000,
        scanTimeoutMs: 30000,
        maxBytes: 50 * 1024 * 1024,
      });
      check((await scanner.health()).status === 'up', 'real ClamAV');
      const handler = new SatPackageJobHandler(
        storage,
        scanner,
        zipPersistence,
        xmlPersistence,
        new XmlObjectProcessor(
          storage,
          scanner,
          new SaxesCfdiParserAdapter(),
          xmlPersistence,
        ),
        new FiscalMetricsService(),
        new SatMetadataProcessor(zipPersistence),
      );
      for (let n = 0; n < 2; n++) {
        const claim = await ingestion.claimNext('sat-controlled', [
          'sat_package',
        ]);
        check(!!claim, 'existing worker claims sat_package');
        if (!claim) throw new Error('claim missing');
        const completion = await handler.handle(
          claim,
          new AbortController().signal,
        );
        check(
          await ingestion.complete(claim, completion),
          'terminal published with live lease',
        );
      }
      await satWorker.runJob(tenant.organizationId!, job.id);
      const completed = await service.get(tenant, job.id);
      check(
        completed.status === 'completed_with_issues',
        'mixed XML package survives invalid entries',
      );
      check(
        completed.counters.incorporated === 1,
        'real parser incorporated one CFDI',
      );
      const xmlCount = (await db.query('SELECT count(*)::int n FROM cfdis'))[0]
        .n;
      metadataMode = true;
      zip = makeZip([
        {
          name: 'metadata.txt',
          body: Buffer.from(
            METADATA_HEADER.join('~') +
              '\n' +
              '12345678-1234-1234-1234-123456789ABC~AAA010101AAA~Issuer~BBB010101BBB~Receiver~CCC010101CCC~2026-01-01T00:00:00~2026-01-01T00:00:01~1.50~I~1~\n',
          ),
        },
      ]);
      const metaJob = await service.create(
        tenant,
        { ...filters, contentType: 'metadata' },
        randomUUID(),
        randomUUID(),
      );
      await authorize(metaJob.id);
      await satWorker.runJob(tenant.organizationId!, metaJob.id);
      await authorize(metaJob.id);
      await satWorker.runJob(tenant.organizationId!, metaJob.id);
      const metaClaim = await ingestion.claimNext('sat-metadata', [
        'sat_package',
      ]);
      if (!metaClaim) throw new Error('metadata claim missing');
      const metaResult = await handler.handle(
        metaClaim,
        new AbortController().signal,
      );
      await ingestion.complete(metaClaim, metaResult);
      await satWorker.runJob(tenant.organizationId!, metaJob.id);
      const metaState = await service.get(tenant, metaJob.id);
      check(
        metaState.status === 'completed',
        'metadata package complete: ' +
          JSON.stringify(
            await db.query(
              'SELECT product_result,error_code FROM ingestion_items WHERE ingestion_job_id=$1',
              [metaClaim.jobId],
            ),
          ),
      );
      check(
        metaState.counters.metadataObservations === 1 &&
          metaState.counters.incorporated === 0,
        'typed metadata observation separate from CFDI',
      );
      check(
        (await db.query('SELECT count(*)::int n FROM cfdis'))[0].n === xmlCount,
        'metadata cannot manufacture XML CFDI',
      );
      await expect(
        workerRepository.transactions.runAsWorker(
          { organizationId: tenant.organizationId! },
          (m) => m.query('UPDATE sat_metadata_observations SET total=0'),
        ),
      ).rejects.toThrow();
      check(true, 'observations immutable for runtime identities');
      const cancelled = await service.create(
        tenant,
        filters,
        randomUUID(),
        randomUUID(),
      );
      await service.cancel(tenant, cancelled.id, randomUUID());
      await satWorker.runJob(tenant.organizationId!, cancelled.id);
      check(
        (await service.get(tenant, cancelled.id)).status === 'cancelled',
        'cancellation converges without SAT call',
      );
      failDownload = true;
      const budgetJob = await service.create(
        tenant,
        filters,
        randomUUID(),
        randomUUID(),
      );
      await authorize(budgetJob.id);
      await satWorker.runJob(tenant.organizationId!, budgetJob.id);
      await authorize(budgetJob.id);
      await satWorker.runJob(tenant.organizationId!, budgetJob.id);
      await satWorker.runJob(tenant.organizationId!, budgetJob.id);
      const budgetPage = await service.packages(tenant, budgetJob.id, 0, 100);
      const budgetId = budgetPage.items[0].id as string;
      check(
        budgetPage.items[0].download_attempts === 1 &&
          budgetPage.items[0].status === 'download_unknown',
        'uncertain package consumes one attempt',
      );
      await service.retry(tenant, budgetJob.id, budgetId, randomUUID());
      await authorize(budgetJob.id);
      await satWorker.runJob(tenant.organizationId!, budgetJob.id);
      await satWorker.runJob(tenant.organizationId!, budgetJob.id);
      const exhausted = await service.packages(tenant, budgetJob.id, 0, 100);
      check(
        exhausted.items[0].download_attempts === 2 &&
          exhausted.items[0].status === 'budget_exhausted',
        'explicit retry cannot exceed official download budget',
      );
      await expect(
        service.retry(tenant, budgetJob.id, budgetId, randomUUID()),
      ).rejects.toThrow();
      check(true, 'third download forbidden');
      failDownload = false;
      const unknown = await service.create(
        tenant,
        filters,
        randomUUID(),
        randomUUID(),
      );
      await authorize(unknown.id);
      loseSubmission = true;
      await satWorker.runJob(tenant.organizationId!, unknown.id);
      check(
        (await service.get(tenant, unknown.id)).status ===
          'external_submission_unknown',
        'lost accepted response remains uncertain',
      );
      const attempts = submissions;
      await satWorker.runJob(tenant.organizationId!, unknown.id);
      check(submissions === attempts, 'uncertain submission not repeated');
      await expect(
        service.get({ ...tenant, organizationId: randomUUID() }, job.id),
      ).rejects.toThrow();
      check(true, 'foreign tenant denied');
      const technical = await service.create(
        tenant,
        filters,
        randomUUID(),
        randomUUID(),
      );
      await db.query(
        "UPDATE sat_download_jobs SET status='requires_user_authorization',error_code='SAT_TECHNICAL_FAILURE',technical_retries=1,next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [technical.id],
      );
      await service.retry(tenant, technical.id, undefined, randomUUID());
      check(
        (
          await db.query(
            'SELECT technical_retries FROM sat_download_jobs WHERE id=$1',
            [technical.id],
          )
        )[0].technical_retries === 1,
        'technical retry never charges the same failed attempt twice',
      );
      await expect(
        service.retry(tenant, technical.id, undefined, randomUUID()),
      ).rejects.toThrow();
      check(true, 'non-retryable state is not a silent retry success');
      await db.query(
        "UPDATE sat_download_jobs SET error_code='SAT_TECHNICAL_FAILURE',next_attempt_at=clock_timestamp()+interval '1 minute' WHERE id=$1",
        [technical.id],
      );
      await expect(
        service.retry(tenant, technical.id, undefined, randomUUID()),
      ).rejects.toThrow();
      check(true, 'technical backoff enforced');
      await expect(
        apiRepository.run(tenant, (m) =>
          m.query(
            "UPDATE sat_download_jobs SET content_type='metadata' WHERE id=$1",
            [technical.id],
          ),
        ),
      ).rejects.toThrow();
      check(true, 'accepted filter identity immutable');
      await service.cancel(tenant, technical.id, randomUUID());
      loseSubmission = false;
      const fencedJob = await service.create(
        tenant,
        filters,
        randomUUID(),
        randomUUID(),
      );
      await authorize(fencedJob.id);
      loseFenceFor = fencedJob.id;
      const beforeFenceSubmissions = submissions;
      await expect(
        satWorker.runJob(tenant.organizationId!, fencedJob.id),
      ).rejects.toThrow();
      check(
        submissions === beforeFenceSubmissions,
        'lost fence prevents new external submission',
      );
      check(
        (
          await db.query(
            'SELECT terminal_at FROM sat_download_jobs WHERE id=$1',
            [fencedJob.id],
          )
        )[0].terminal_at === null,
        'lost lease cannot publish terminal result',
      );
      await satWorker.runJob(tenant.organizationId!, fencedJob.id);
      check(
        (await service.get(tenant, fencedJob.id)).status ===
          'requires_user_authorization',
        'restart after consumed credential requires fresh authorization',
      );
      await service.cancel(tenant, fencedJob.id, randomUUID());
      await cleaner.reconcile();
      await db.query(
        "UPDATE stored_objects SET retention_until=clock_timestamp()-interval '1 second',cleanup_requested_at=clock_timestamp()-interval '6 minutes' WHERE kind='sat_package'",
      );
      const satCleanup = new ZipCleanupService(
        transactions,
        storage,
        new FiscalMetricsService(),
      );
      await satCleanup.reconcile();
      await satCleanup.reconcile();
      check(
        (
          await db.query(
            "SELECT count(*)::int n FROM stored_objects WHERE kind='sat_package' AND lifecycle_state<>'deleted'",
          )
        )[0].n === 0,
        'root cleanup durable and idempotent',
      );
      check(
        (await db.query('SELECT count(*)::int n FROM cfdis'))[0].n === 1,
        'cleanup preserves original CFDI',
      );
      check(
        signatures >= 8,
        'controlled server verifies real reference digests',
      );
      console.log(
        JSON.stringify({
          phase4LocalIntegration: 'PASS',
          assertions: count,
          signatures,
          submissions,
          downloads,
          realServices: [
            'PostgreSQL',
            'Vault wrapping/Transit',
            'MinIO',
            'ClamAV',
            'CFDI parser',
            'controlled SAT server',
          ],
          realSatAcceptance: 'NOT_RUN',
        }),
      );
    } finally {
      if (satServer)
        await new Promise<void>((r) => satServer!.close(() => r()));
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (db?.isInitialized) {
        const rows: { object_key: string }[] = await db
          .query(
            `SELECT object_key FROM stored_objects WHERE kind IN('credential_certificate','credential_private_key','sat_package','extracted_xml')`,
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
