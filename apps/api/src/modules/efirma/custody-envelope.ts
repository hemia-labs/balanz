import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** This is a custody format, not a certificate or SAT credential profile. */
export interface CustodyContext {
  organizationId: string;
  legalEntityId: string;
  intentionId: string;
  purpose: 'efirma.prepare' | 'sat.submit' | 'sat.recover';
  sat?: {
    jobId: string;
    filterVersion: 1;
    userId: string;
    sessionId: string;
    membershipId: string;
  };
  expiresAt: string;
  generation: string;
}

export function custodyAad(context: CustodyContext): Buffer {
  if (context.purpose !== 'efirma.prepare') {
    if (!context.sat || context.sat.filterVersion !== 1)
      throw new Error('EFIRMA_ENVELOPE_INVALID');
    return Buffer.from(
      JSON.stringify([
        2,
        context.organizationId,
        context.legalEntityId,
        context.intentionId,
        context.purpose,
        context.expiresAt,
        context.generation,
        context.sat.jobId,
        context.sat.filterVersion,
        context.sat.userId,
        context.sat.sessionId,
        context.sat.membershipId,
      ]),
    );
  }
  if (context.sat) throw new Error('EFIRMA_ENVELOPE_INVALID');
  return Buffer.from(
    JSON.stringify([
      1,
      context.organizationId,
      context.legalEntityId,
      context.intentionId,
      context.purpose,
      context.expiresAt,
      context.generation,
    ]),
  );
}

export function encryptPrivateKey(
  key: Buffer,
  dek: Buffer,
  context: CustodyContext,
): Buffer {
  if (dek.length !== 32) throw new Error('EFIRMA_ENVELOPE_INVALID');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, nonce);
  cipher.setAAD(custodyAad(context));
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  return Buffer.concat([
    Buffer.from([context.purpose === 'efirma.prepare' ? 1 : 2]),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

export function decryptPrivateKey(
  envelope: Buffer,
  dek: Buffer,
  context: CustodyContext,
): Buffer {
  let plaintext: Buffer | undefined;
  try {
    if (
      dek.length !== 32 ||
      envelope.length < 30 ||
      envelope.length > 32768 ||
      envelope[0] !== (context.purpose === 'efirma.prepare' ? 1 : 2)
    )
      throw new Error();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      dek,
      envelope.subarray(1, 13),
    );
    decipher.setAAD(custodyAad(context));
    decipher.setAuthTag(envelope.subarray(13, 29));
    plaintext = decipher.update(envelope.subarray(29));
    return Buffer.concat([plaintext, decipher.final()]);
  } catch {
    throw new Error('EFIRMA_ENVELOPE_INVALID');
  } finally {
    plaintext?.fill(0);
  }
}
