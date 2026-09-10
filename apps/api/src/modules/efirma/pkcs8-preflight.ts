import { fromBER, OctetString, Null, Constructed } from 'asn1js';
import { PKCS8ShroudedKeyBag, PBES2Params, PBKDF2Params } from 'pkijs';
import { createPrivateKey, type KeyObject } from 'node:crypto';

/** Hemia limits, not SAT limits. PBES2/PBKDF2/AES-256-CBC only. */
export const PKCS8_LIMITS = Object.freeze({
  bytes: 16384,
  iterations: 200000,
  concurrent: 2,
  saltMin: 8,
  saltMax: 64,
});
export function boundedDer(bytes: Buffer) {
  if (!bytes.length || bytes.length > PKCS8_LIMITS.bytes)
    throw new Error('EFIRMA_DER_INVALID');
  const parsed = fromBER(Uint8Array.from(bytes), {
    maxDepth: 16,
    maxNodes: 512,
    maxContentLength: PKCS8_LIMITS.bytes,
  });
  if (
    parsed.offset !== bytes.length ||
    parsed.result.error ||
    parsed.result.warnings.length ||
    !Buffer.from(parsed.result.toBER()).equals(bytes)
  )
    throw new Error('EFIRMA_DER_INVALID');
  const pending = [parsed.result];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.lenBlock.isIndefiniteForm || node.error || node.warnings.length)
      throw new Error('EFIRMA_DER_INVALID');
    if (node instanceof Constructed) pending.push(...node.valueBlock.value);
  }
  return parsed.result;
}
export function pkcs8Preflight(bytes: Buffer) {
  try {
    const key = new PKCS8ShroudedKeyBag({ schema: boundedDer(bytes) });
    if (key.encryptionAlgorithm.algorithmId !== '1.2.840.113549.1.5.13')
      throw new Error();
    const pbes = new PBES2Params({
      schema: key.encryptionAlgorithm.algorithmParams,
    });
    if (
      pbes.keyDerivationFunc.algorithmId !== '1.2.840.113549.1.5.12' ||
      pbes.encryptionScheme.algorithmId !== '2.16.840.1.101.3.4.1.42'
    )
      throw new Error();
    const kdf = new PBKDF2Params({
      schema: pbes.keyDerivationFunc.algorithmParams,
    });
    const salt: unknown = kdf.salt,
      iv: unknown = pbes.encryptionScheme.algorithmParams;
    if (
      !(salt instanceof OctetString) ||
      salt.idBlock.isConstructed ||
      !(iv instanceof OctetString) ||
      iv.idBlock.isConstructed ||
      iv.valueBlock.valueHexView.length !== 16
    )
      throw new Error();
    if (
      salt.valueBlock.valueHexView.length < 8 ||
      salt.valueBlock.valueHexView.length > 64 ||
      !Number.isSafeInteger(kdf.iterationCount) ||
      kdf.iterationCount < 1 ||
      kdf.iterationCount > PKCS8_LIMITS.iterations ||
      (kdf.keyLength !== undefined && kdf.keyLength !== 32)
    )
      throw new Error();
    const prf = kdf.prf?.algorithmId ?? '1.2.840.113549.2.7';
    if (
      !['1.2.840.113549.2.7', '1.2.840.113549.2.9'].includes(prf) ||
      (kdf.prf?.algorithmParams !== undefined &&
        !(kdf.prf.algorithmParams instanceof Null))
    )
      throw new Error();
    const size = key.encryptedData.valueBlock.valueHexView.length;
    if (
      key.encryptedData.idBlock.isConstructed ||
      size < 16 ||
      size % 16 ||
      size > PKCS8_LIMITS.bytes
    )
      throw new Error();
    return {
      iterations: kdf.iterationCount,
      prf,
      cipher: 'aes-256-cbc' as const,
    };
  } catch {
    throw new Error('EFIRMA_PKCS8_UNSUPPORTED');
  }
}
let active = 0;
export async function openProtectedKey(
  bytes: Buffer,
  password: Buffer,
): Promise<KeyObject> {
  pkcs8Preflight(bytes);
  if (active >= PKCS8_LIMITS.concurrent) throw new Error('EFIRMA_KDF_BUSY');
  active++;
  try {
    // Admission yields before bounded synchronous OpenSSL work, allowing concurrent requests to be rejected.
    await new Promise<void>((resolve) => setImmediate(resolve));
    return createPrivateKey({
      key: bytes,
      format: 'der',
      type: 'pkcs8',
      passphrase: password,
    });
  } finally {
    active--;
  }
}
