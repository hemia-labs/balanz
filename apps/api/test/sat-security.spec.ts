import { randomBytes, pbkdf2Sync } from 'node:crypto';
import {
  PKCS8ShroudedKeyBag,
  PBES2Params,
  PBKDF2Params,
  AlgorithmIdentifier,
} from 'pkijs';
import { OctetString } from 'asn1js';
import {
  boundedDer,
  pkcs8Preflight,
  PKCS8_LIMITS,
} from '../src/modules/efirma/pkcs8-preflight';
import { syntheticCredential } from './fixtures/efirma-fixture';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  type CustodyContext,
} from '../src/modules/efirma/custody-envelope';
import {
  SatAdapter,
  PRODUCTION_ENDPOINTS,
} from '../src/modules/sat-download/sat-adapter';
import { SatCertificateValidator } from '../src/modules/efirma/sat-certificate-validator';
describe('SAT authorization and bounded key preflight', () => {
  let fixture: Awaited<ReturnType<typeof syntheticCredential>>;
  beforeAll(async () => {
    fixture = await syntheticCredential();
  });
  afterAll(() => fixture.password.fill(0));
  const context: CustodyContext = {
    organizationId: 'org',
    legalEntityId: 'entity',
    intentionId: 'intent',
    purpose: 'sat.submit',
    generation: 'generation',
    expiresAt: '2026-09-10T00:10:00Z',
    sat: {
      jobId: 'job',
      filterVersion: 1,
      userId: 'user',
      sessionId: 'session',
      membershipId: 'member',
    },
  };
  it.each(['jobId', 'userId', 'sessionId', 'membershipId'])(
    'binds the encrypted envelope to %s',
    (field) => {
      const dek = randomBytes(32),
        envelope = encryptPrivateKey(Buffer.from('synthetic'), dek, context);
      expect(envelope[0]).toBe(2);
      expect(() =>
        decryptPrivateKey(envelope, dek, {
          ...context,
          sat: { ...context.sat!, [field]: 'other' },
        }),
      ).toThrow();
    },
  );
  it('never reinterprets efirma.prepare or another SAT purpose', () => {
    const dek = randomBytes(32),
      envelope = encryptPrivateKey(Buffer.from('synthetic'), dek, context);
    expect(() =>
      decryptPrivateKey(envelope, dek, { ...context, purpose: 'sat.recover' }),
    ).toThrow();
    expect(() =>
      decryptPrivateKey(envelope, dek, {
        ...context,
        purpose: 'efirma.prepare',
        sat: undefined,
      }),
    ).toThrow();
  });
  it.each(['iterations', 'length', 'salt', 'iv', 'cipher', 'prf'])(
    'rejects unsupported PKCS8 %s before opening the key',
    (variant) => {
      const key = new PKCS8ShroudedKeyBag({
          schema: boundedDer(fixture.encryptedKey),
        }),
        pbes = new PBES2Params({
          schema: key.encryptionAlgorithm.algorithmParams,
        }),
        kdf = new PBKDF2Params({
          schema: pbes.keyDerivationFunc.algorithmParams,
        });
      if (variant === 'iterations')
        kdf.iterationCount = PKCS8_LIMITS.iterations + 1;
      if (variant === 'length') kdf.keyLength = 64;
      if (variant === 'salt')
        kdf.salt = new OctetString({ valueHex: new Uint8Array(65).buffer });
      if (variant === 'iv')
        pbes.encryptionScheme.algorithmParams = new OctetString({
          valueHex: new Uint8Array(15).buffer,
        });
      if (variant === 'cipher')
        pbes.encryptionScheme.algorithmId = '1.2.840.113549.3.7';
      if (variant === 'prf')
        kdf.prf = new AlgorithmIdentifier({
          algorithmId: '1.2.840.113549.2.11',
        });
      pbes.keyDerivationFunc.algorithmParams = kdf.toSchema();
      key.encryptionAlgorithm.algorithmParams = pbes.toSchema();
      expect(() => pkcs8Preflight(Buffer.from(key.toSchema().toBER()))).toThrow(
        'EFIRMA_PKCS8_UNSUPPORTED',
      );
    },
  );
  it('does not silently promote a synthetic fixture to a real certificate profile', async () => {
    await expect(
      new SatCertificateValidator('missing-server-trust-bundle').validate(
        fixture.certificate,
        fixture.encryptedKey,
        fixture.password,
        'AAA010101AAA',
      ),
    ).rejects.toThrow();
  });
  it('rejects redirects/foreign configuration and accepts only exact SAT destinations', () => {
    expect(
      () =>
        new SatAdapter({
          ...PRODUCTION_ENDPOINTS,
          isolated: false,
          request: 'https://example.invalid/request',
        }),
    ).toThrow();
    expect(
      () =>
        new SatAdapter({
          ...PRODUCTION_ENDPOINTS,
          isolated: false,
          request: PRODUCTION_ENDPOINTS.request + '?target=x',
        }),
    ).toThrow();
    expect(
      () => new SatAdapter({ ...PRODUCTION_ENDPOINTS, isolated: false }),
    ).not.toThrow();
  });
  it('measures the explicit Hemia PBKDF2 ceiling on synthetic bytes', () => {
    const measurements: Record<string, number> = {};
    for (const prf of ['sha1', 'sha256']) {
      const values: number[] = [];
      for (let n = 0; n < 3; n++) {
        const start = performance.now();
        const derived = pbkdf2Sync(
          Buffer.from('synthetic-only'),
          Buffer.alloc(16, 7),
          PKCS8_LIMITS.iterations,
          32,
          prf,
        );
        values.push(performance.now() - start);
        derived.fill(0);
      }
      measurements[prf] = Math.round(Math.max(...values));
    }
    console.log(
      JSON.stringify({
        hemiaPbkdf2Iterations: PKCS8_LIMITS.iterations,
        maxMilliseconds: measurements,
        concurrency: PKCS8_LIMITS.concurrent,
        node: process.version,
      }),
    );
    expect(PKCS8_LIMITS.iterations).toBe(200000);
  });
});
