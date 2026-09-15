import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { EfirmaConfig } from './efirma.config';
import { efirmaError } from '../modules/efirma/efirma.errors';

// Operator-owned, external to custody snapshots; never supplied by an HTTP request.
// A reference records an external decision; it is not a legal approval produced by code.
export interface RealPilotAuthorization {
  version: 1;
  purpose: 'sat_xml_pilot';
  organizationId: string;
  legalEntityId: string;
  authorizationReference: string;
  notBefore: string;
  expiresAt: string;
  generation: string;
  trustBundleSha256: string;
}
export function assertRealPilot(
  config: EfirmaConfig,
  scope?: {
    organization_id: string;
    legal_entity_id: string;
    purpose?: string;
  },
): void {
  if (config.runtimeMode !== 'real_pilot') return;
  try {
    if (
      !config.enabled ||
      config.certificateProfile !== 'sat_efirma_v1' ||
      !config.realPilotFile ||
      !isAbsolute(config.realPilotFile)
    )
      throw new Error();
    const raw = readFileSync(config.realPilotFile);
    if (raw.length > 8192) throw new Error();
    const permit = JSON.parse(raw.toString('utf8')) as RealPilotAuthorization;
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const start = Date.parse(permit.notBefore),
      end = Date.parse(permit.expiresAt);
    if (
      permit.version !== 1 ||
      permit.purpose !== 'sat_xml_pilot' ||
      !uuid.test(permit.organizationId) ||
      !uuid.test(permit.legalEntityId) ||
      !uuid.test(permit.generation) ||
      typeof permit.authorizationReference !== 'string' ||
      !/^[a-zA-Z0-9._:/-]{1,160}$/.test(permit.authorizationReference) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start > Date.now() ||
      end <= Date.now() ||
      end <= start ||
      end - start > 86400000 ||
      !/^[a-f0-9]{64}$/.test(permit.trustBundleSha256)
    )
      throw new Error();
    if (
      scope &&
      (scope.organization_id !== permit.organizationId ||
        scope.legal_entity_id !== permit.legalEntityId ||
        (scope.purpose !== undefined &&
          !['sat.submit', 'sat.recover'].includes(scope.purpose)))
    )
      throw new Error();
    const generation = readFileSync(config.generationFile, 'utf8').trim();
    const trust = readFileSync(config.satTrustFile ?? '');
    if (
      generation !== permit.generation ||
      trust.length > 256 * 1024 ||
      createHash('sha256').update(trust).digest('hex') !==
        permit.trustBundleSha256
    )
      throw new Error();
    const bundle = JSON.parse(trust.toString('utf8')) as {
      profile?: string;
      roots?: unknown[];
      generations?: unknown[];
    };
    if (
      bundle.profile !== 'sat_efirma_v1' ||
      !Array.isArray(bundle.roots) ||
      !bundle.roots.length ||
      !Array.isArray(bundle.generations) ||
      !bundle.generations.length
    )
      throw new Error();
  } catch {
    throw efirmaError('EFIRMA_REAL_PILOT_NOT_AUTHORIZED', 503);
  }
}
