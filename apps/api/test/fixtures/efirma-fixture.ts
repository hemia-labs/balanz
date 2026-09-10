import 'reflect-metadata';
import { KeyObject, randomBytes, createHash, webcrypto } from 'node:crypto';
import {
  X509CertificateGenerator,
  BasicConstraintsExtension,
  KeyUsagesExtension,
  KeyUsageFlags,
  ExtendedKeyUsageExtension,
} from '@peculiar/x509';

/** Generate synthetic certificate/key pairs entirely in memory; never an OpenSSL process or private file. */
export async function syntheticCredential(
  organizationalUnit = 'HEMIA SYNTHETIC EFIRMA V1',
) {
  const algorithm = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  };
  const root = await webcrypto.subtle.generateKey(algorithm, true, [
    'sign',
    'verify',
  ]);
  const leaf = await webcrypto.subtle.generateKey(algorithm, true, [
    'sign',
    'verify',
  ]);
  const crypto = webcrypto as unknown as Crypto;
  const now = Date.now();
  const rootCertificate = await X509CertificateGenerator.createSelfSigned(
    {
      name: 'CN=Hemia Synthetic QA Root',
      keys: root as unknown as CryptoKeyPair,
      notBefore: new Date(now - 60000),
      notAfter: new Date(now + 2 * 86400000),
      extensions: [
        new BasicConstraintsExtension(true, 0, true),
        new KeyUsagesExtension(
          KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign,
          true,
        ),
      ],
    },
    crypto,
  );
  const certificate = Buffer.from(
    (
      await X509CertificateGenerator.create(
        {
          subject: [
            { CN: ['Hemia QA'] },
            { OU: [organizationalUnit] },
            { '2.5.4.5': ['AAA010101AAA'] },
          ],
          issuer: rootCertificate.subjectName,
          publicKey: leaf.publicKey as unknown as CryptoKey,
          signingKey: root.privateKey as unknown as CryptoKey,
          notBefore: new Date(now - 60000),
          notAfter: new Date(now + 86400000),
          extensions: [
            new BasicConstraintsExtension(false, undefined, true),
            new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
            new ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.2']),
          ],
        },
        crypto,
      )
    ).rawData,
  );
  const password = Buffer.from(randomBytes(24).toString('base64url'));
  const encryptedKey = KeyObject.from(leaf.privateKey).export({
    format: 'der',
    type: 'pkcs8',
    cipher: 'aes-256-cbc',
    passphrase: password,
  });
  const rootBytes = Buffer.from(rootCertificate.rawData);
  return {
    certificate,
    encryptedKey,
    password,
    rootCertificate: rootBytes,
    trust: {
      profile: 'synthetic_v1',
      rootCertificate: rootCertificate.toString('pem'),
      encryptedKeys: [createHash('sha256').update(encryptedKey).digest('hex')],
    },
  };
}
