import { EfirmaConsumerService } from '../src/modules/efirma/efirma-consumer.service';
import type { ObjectStoragePort } from '../src/modules/object-storage/ports/object-storage.port';
import type { VaultCustodyAdapter } from '../src/modules/efirma/vault-custody.adapter';
import type { EntityManager } from 'typeorm';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  efirmaConfiguration,
  type EfirmaConfig,
} from '../src/config/efirma.config';
import {
  assertRealPilot,
  type RealPilotAuthorization,
} from '../src/config/efirma-real-pilot';
import {
  SatAdapter,
  PRODUCTION_ENDPOINTS,
} from '../src/modules/sat-download/sat-adapter';
import { SatService } from '../src/modules/sat-download/sat.service';
import { SatWorkerModule } from '../src/modules/sat-download/sat.module';
import type { EfirmaRepository } from '../src/modules/efirma/efirma.repository';
import type { EfirmaPreparationService } from '../src/modules/efirma/efirma-preparation.service';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';
import type { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';

describe('real pilot composition without network or real credentials', () => {
  let dir: string,
    env: NodeJS.ProcessEnv,
    config: EfirmaConfig,
    permit: RealPilotAuthorization;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hemia-sat-runtime-test-'));
    const generation = randomUUID();
    // Configuration shape only; deliberately not certificate evidence or a trustable chain.
    const trust = JSON.stringify({
      profile: 'sat_efirma_v1',
      roots: ['NOT-A-CERTIFICATE'],
      generations: ['NOT-A-SAT-RULE'],
    });
    writeFileSync(join(dir, 'generation'), generation);
    writeFileSync(join(dir, 'trust.json'), trust);
    permit = {
      version: 1,
      purpose: 'sat_xml_pilot',
      organizationId: randomUUID(),
      legalEntityId: randomUUID(),
      authorizationReference: 'TEST-ONLY-NOT-HUMAN-APPROVAL',
      notBefore: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      generation,
      trustBundleSha256: createHash('sha256').update(trust).digest('hex'),
    };
    writeFileSync(join(dir, 'permit.json'), JSON.stringify(permit));
    env = {
      NODE_ENV: 'production',
      SAT_ENABLED: 'true',
      EFIRMA_ENABLED: 'true',
      EFIRMA_RUNTIME_MODE: 'real_pilot',
      EFIRMA_CERTIFICATE_PROFILE: 'sat_efirma_v1',
      EFIRMA_REAL_PILOT_AUTHORIZATION_FILE: join(dir, 'permit.json'),
      EFIRMA_SAT_TRUST_FILE: join(dir, 'trust.json'),
      EFIRMA_CUSTODY_GENERATION_FILE: join(dir, 'generation'),
      EFIRMA_VAULT_ADDR: 'https://vault.example.invalid',
      EFIRMA_TRANSIT_MOUNT: 'custody',
      EFIRMA_TRANSIT_KEY: 'wrapping',
      EFIRMA_PREPARER_ROLE_ID: 'test-role',
      EFIRMA_PREPARER_SECRET_ID: 'test-secret',
      OBJECT_STORAGE_DRIVER: 's3',
      S3_SSE_MODE: 'aws:kms',
      MALWARE_SCANNER_MODE: 'clamav',
    };
    config = efirmaConfiguration('api', env);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });
  it('is disabled by default without requiring Vault or external files', () => {
    expect(efirmaConfiguration('api', {}).enabled).toBe(false);
  });
  it.each(['EFIRMA_QA_ISOLATED', 'SAT_QA_ISOLATED'])(
    'rejects the QA exception %s in real mode',
    (name) => {
      expect(() =>
        efirmaConfiguration('api', { ...env, [name]: 'true' }),
      ).toThrow();
    },
  );
  it.each([
    { EFIRMA_CERTIFICATE_PROFILE: 'synthetic_v1' },
    { SAT_CONTROLLED_ENDPOINT: 'http://127.0.0.1' },
    { EFIRMA_VAULT_ADDR: 'http://vault.example.invalid' },
    { EFIRMA_REAL_PILOT_AUTHORIZATION_FILE: '' },
  ])('rejects incomplete/unsafe real configuration %j', (override) => {
    expect(() => efirmaConfiguration('api', { ...env, ...override })).toThrow();
  });
  it('composes only official HTTPS endpoints without making a request', () => {
    jest.replaceProperty(process, 'env', env);
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network forbidden'));
    const providers = Reflect.getMetadata('providers', SatWorkerModule) as {
      provide?: string;
      useFactory?: (m: FiscalMetricsService, c: ConfigService) => SatAdapter;
    }[];
    const adapter = providers.find((p) => p.provide === 'SAT_ADAPTER')!
      .useFactory!(
      {} as FiscalMetricsService,
      new ConfigService({ efirma: config }),
    );
    expect(adapter).toBeInstanceOf(SatAdapter);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      () =>
        new SatAdapter({
          ...PRODUCTION_ENDPOINTS,
          download: 'https://example.invalid',
          isolated: false,
        }),
    ).toThrow();
  });
  it('rejects expiry, deletion and a changed generation without restarting', () => {
    assertRealPilot(config);
    writeFileSync(
      config.realPilotFile!,
      JSON.stringify({
        ...permit,
        expiresAt: new Date(Date.now() - 1).toISOString(),
      }),
    );
    expect(() => assertRealPilot(config)).toThrow();
    writeFileSync(config.realPilotFile!, JSON.stringify(permit));
    writeFileSync(config.generationFile, randomUUID());
    expect(() => assertRealPilot(config)).toThrow();
    rmSync(config.realPilotFile!);
    expect(() => assertRealPilot(config)).toThrow();
  });
  it('pins the trust bytes and the exact tenant, entity and operation', () => {
    const scope = {
      organization_id: permit.organizationId,
      legal_entity_id: permit.legalEntityId,
      purpose: 'sat.submit',
    };
    assertRealPilot(config, scope);
    expect(() =>
      assertRealPilot(config, { ...scope, legal_entity_id: randomUUID() }),
    ).toThrow();
    expect(() =>
      assertRealPilot(config, { ...scope, organization_id: randomUUID() }),
    ).toThrow();
    expect(() =>
      assertRealPilot(config, { ...scope, purpose: 'efirma.prepare' }),
    ).toThrow();
    writeFileSync(config.satTrustFile!, '{}');
    expect(() => assertRealPilot(config, scope)).toThrow();
  });
  it('keeps metadata outside the real XML pilot before durable creation', async () => {
    jest.replaceProperty(process, 'env', env);
    const repository = { config, run: jest.fn() };
    const service = new SatService(
      repository as unknown as EfirmaRepository,
      {} as EfirmaPreparationService,
    );
    await expect(
      service.create(
        {
          organizationId: permit.organizationId,
        } as SessionAuthorizationContext,
        {
          legalEntityId: permit.legalEntityId,
          direction: 'issued',
          contentType: 'metadata',
          documentType: 'I',
          documentStatus: 'active',
        },
        randomUUID(),
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect(repository.run).not.toHaveBeenCalled();
  });
  it('cannot consume a previously prepared synthetic custody through the real mode', async () => {
    const manager = {
      query: jest.fn().mockResolvedValue([
        {
          generation: permit.generation,
          certificate_profile: 'synthetic_v1',
        },
      ]),
    } as unknown as EntityManager;
    const repository = {
      config,
      generation: jest.fn().mockResolvedValue(permit.generation),
      transactions: {
        runAsWorker: <T>(
          _scope: unknown,
          work: (m: EntityManager) => Promise<T>,
        ) => work(manager),
      },
    };
    const vault = { unwrap: jest.fn() },
      operation = jest.fn();
    const consumer = new EfirmaConsumerService(
      repository as unknown as EfirmaRepository,
      {} as ObjectStoragePort,
      vault as unknown as VaultCustodyAdapter,
    );
    await expect(
      consumer.withCredential(permit.organizationId, randomUUID(), operation, {
        purpose: 'sat.submit',
        jobId: randomUUID(),
        filterVersion: 1,
      }),
    ).rejects.toThrow();
    expect(vault.unwrap).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });
});
