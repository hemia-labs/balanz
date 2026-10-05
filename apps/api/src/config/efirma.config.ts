import { assertRealPilot } from './efirma-real-pilot';
import { registerAs } from '@nestjs/config';
import { isAbsolute } from 'node:path';
import type { RuntimeConfigProfile } from './env.validation';
import type { VaultCustodyConfiguration } from '../modules/efirma/vault-custody.adapter';

export interface EfirmaConfig {
  enabled: boolean;
  runtimeMode?: 'controlled' | 'real_pilot';
  realPilotFile?: string;
  certificateProfile?: 'synthetic_v1' | 'sat_efirma_v1';
  satTrustFile?: string;
  generationFile: string;
  syntheticTrustFile: string;
  sessionIdleSeconds: number;
  vault?: VaultCustodyConfiguration;
  cleanupVault?: VaultCustodyConfiguration;
}

export function efirmaConfiguration(
  profile: RuntimeConfigProfile,
  env = process.env,
): EfirmaConfig {
  const disabled: EfirmaConfig = {
    enabled: false,
    generationFile: '',
    syntheticTrustFile: '',
    sessionIdleSeconds: 1800,
  };
  if (env.EFIRMA_ENABLED !== 'true') return disabled;
  const loopback = (host?: string) =>
    !!host && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Missing Phase 3 configuration: ${name}`);
    return value;
  };
  const address = new URL(required('EFIRMA_VAULT_ADDR'));
  const realPilot = env.EFIRMA_RUNTIME_MODE === 'real_pilot';
  if (
    env.EFIRMA_RUNTIME_MODE &&
    !['controlled', 'real_pilot'].includes(env.EFIRMA_RUNTIME_MODE)
  )
    throw new Error('Invalid custody runtime mode');
  if (
    realPilot &&
    (env.NODE_ENV !== 'production' ||
      env.EFIRMA_CERTIFICATE_PROFILE !== 'sat_efirma_v1' ||
      env.EFIRMA_QA_ISOLATED === 'true' ||
      env.SAT_QA_ISOLATED === 'true' ||
      !!env.SAT_CONTROLLED_ENDPOINT ||
      !!env.EFIRMA_SYNTHETIC_TRUST_FILE ||
      env.DB_LOGGING === 'true' ||
      env.OBJECT_STORAGE_DRIVER !== 's3' ||
      !['AES256', 'aws:kms'].includes(env.S3_SSE_MODE ?? '') ||
      env.MALWARE_SCANNER_MODE !== 'clamav' ||
      address.protocol !== 'https:' ||
      address.username ||
      address.password ||
      address.search ||
      address.hash ||
      address.pathname !== '/' ||
      (env.S3_ENDPOINT && new URL(env.S3_ENDPOINT).protocol !== 'https:'))
  )
    throw new Error(
      'Real pilot requires a managed, isolated-from-QA custody configuration',
    );
  if (
    !realPilot &&
    (env.NODE_ENV !== 'test' ||
      env.EFIRMA_QA_ISOLATED !== 'true' ||
      !['synthetic_v1', 'sat_efirma_v1'].includes(
        env.EFIRMA_CERTIFICATE_PROFILE ?? '',
      ) ||
      env.SECRETS_ENABLED === 'true' ||
      env.DB_LOGGING === 'true' ||
      (env.OBJECT_STORAGE_DRIVER === 's3' && !env.S3_ENDPOINT) ||
      !loopback(env.DB_HOST) ||
      !/^test_[a-zA-Z0-9_]+$/.test(env.DB_DATABASE ?? '') ||
      !loopback(address.hostname) ||
      address.username ||
      address.password ||
      !['http:', 'https:'].includes(address.protocol) ||
      (env.S3_ENDPOINT && !loopback(new URL(env.S3_ENDPOINT).hostname)))
  ) {
    throw new Error('Phase 3 currently permits isolated synthetic QA only');
  }
  const generationFile = required('EFIRMA_CUSTODY_GENERATION_FILE');
  const certificateProfile = env.EFIRMA_CERTIFICATE_PROFILE as
    | 'synthetic_v1'
    | 'sat_efirma_v1';
  const syntheticTrustFile = required(
    certificateProfile === 'synthetic_v1'
      ? 'EFIRMA_SYNTHETIC_TRUST_FILE'
      : 'EFIRMA_SAT_TRUST_FILE',
  );
  if (!isAbsolute(generationFile) || !isAbsolute(syntheticTrustFile))
    throw new Error('Phase 3 files require absolute paths');
  const makeVault = (identity: string): VaultCustodyConfiguration => ({
    address: address.origin,
    transitMount: required('EFIRMA_TRANSIT_MOUNT'),
    transitKey: required('EFIRMA_TRANSIT_KEY'),
    identity: {
      roleId: required(`EFIRMA_${identity}_ROLE_ID`),
      secretId: required(`EFIRMA_${identity}_SECRET_ID`),
    },
  });
  const sessionIdleSeconds = Number(env.AUTH_SESSION_IDLE_TTL_SECONDS ?? 1800);
  if (
    !Number.isInteger(sessionIdleSeconds) ||
    sessionIdleSeconds < 1 ||
    sessionIdleSeconds > 86400
  )
    throw new Error('Invalid Phase 3 idle limit');
  const config: EfirmaConfig = {
    enabled: true,
    runtimeMode: realPilot ? 'real_pilot' : 'controlled',
    realPilotFile: realPilot
      ? required('EFIRMA_REAL_PILOT_AUTHORIZATION_FILE')
      : undefined,
    certificateProfile,
    satTrustFile:
      certificateProfile === 'sat_efirma_v1' ? syntheticTrustFile : undefined,
    generationFile,
    syntheticTrustFile,
    sessionIdleSeconds,
    vault: makeVault(profile === 'api' ? 'PREPARER' : 'CONSUMER'),
    cleanupVault: profile === 'worker' ? makeVault('CLEANUP') : undefined,
  };
  assertRealPilot(config);
  return config;
}

export function efirmaConfigForRuntime(profile: RuntimeConfigProfile) {
  return registerAs('efirma', () => efirmaConfiguration(profile));
}
