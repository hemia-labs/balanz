import { randomBytes } from 'node:crypto';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  type CustodyContext,
} from '../src/modules/efirma/custody-envelope';

describe('custody envelope', () => {
  const context: CustodyContext = {
    organizationId: 'org',
    legalEntityId: 'entity',
    intentionId: 'intent',
    purpose: 'efirma.prepare',
    expiresAt: '2026-09-09T00:10:00.000Z',
    generation: 'generation',
  };
  it('round trips with fresh nonces and no plaintext in the envelope', () => {
    const key = Buffer.from('synthetic private key material');
    const dek = randomBytes(32);
    const first = encryptPrivateKey(key, dek, context);
    expect(first.equals(encryptPrivateKey(key, dek, context))).toBe(false);
    expect(first.includes(key)).toBe(false);
    expect(decryptPrivateKey(first, dek, context)).toEqual(key);
  });
  it.each(Object.keys(context))('authenticates %s', (field) => {
    const dek = randomBytes(32);
    const encrypted = encryptPrivateKey(Buffer.from('key'), dek, context);
    expect(() =>
      decryptPrivateKey(encrypted, dek, { ...context, [field]: 'other' }),
    ).toThrow('EFIRMA_ENVELOPE_INVALID');
  });
  it.each([0, 1, 13, 29])('rejects tampering at byte %s', (offset) => {
    const dek = randomBytes(32);
    const encrypted = encryptPrivateKey(Buffer.from('key'), dek, context);
    encrypted[offset] ^= 1;
    expect(() => decryptPrivateKey(encrypted, dek, context)).toThrow(
      'EFIRMA_ENVELOPE_INVALID',
    );
  });
  it('rejects another DEK without exposing crypto errors', () => {
    const encrypted = encryptPrivateKey(
      Buffer.from('key'),
      randomBytes(32),
      context,
    );
    expect(() =>
      decryptPrivateKey(encrypted, randomBytes(32), context),
    ).toThrow('EFIRMA_ENVELOPE_INVALID');
  });
});
