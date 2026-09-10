import 'reflect-metadata';
import { createPrivateKey, X509Certificate, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  X509Certificate as StructuredCertificate,
  BasicConstraintsExtension,
  KeyUsagesExtension,
  KeyUsageFlags,
  ExtendedKeyUsageExtension,
} from '@peculiar/x509';
import { digest } from './efirma.repository';
import { efirmaError } from './efirma.errors';

interface SyntheticTrust {
  profile: 'synthetic_v1';
  rootCertificate: string;
  /** Server-controlled fixture pins also bound the otherwise attacker-controlled PKCS8 KDF cost. */
  encryptedKeys: string[];
}

/** Closed QA profile; deliberately cannot assert that an arbitrary SAT certificate is e.firma. */
export class CertificateValidator {
  constructor(private readonly trustFile: string) {}

  async validate(
    certificate: Buffer,
    encryptedKey: Buffer,
    password: Buffer,
    rfc: string,
  ): Promise<{ key: KeyObject; certificate: X509Certificate }> {
    let code = 'EFIRMA_CERTIFICATE_PROFILE_REJECTED';
    try {
      if (
        certificate.length > 16384 ||
        encryptedKey.length > 16384 ||
        password.length > 1024
      )
        throw new Error();
      const trustBytes = await readFile(this.trustFile);
      if (trustBytes.length > 65536) throw new Error();
      const trust = JSON.parse(trustBytes.toString('utf8')) as SyntheticTrust;
      if (
        trust.profile !== 'synthetic_v1' ||
        !Array.isArray(trust.encryptedKeys) ||
        !trust.encryptedKeys.includes(digest(encryptedKey))
      )
        throw new Error();
      const leaf = new X509Certificate(certificate);
      const root = new X509Certificate(trust.rootCertificate);
      const parseOptions = {
        berOptions: { maxDepth: 16, maxNodes: 512, maxContentLength: 16384 },
      };
      const parsed = new StructuredCertificate(
        Uint8Array.from(certificate),
        parseOptions,
      );
      const parsedRoot = new StructuredCertificate(
        trust.rootCertificate,
        parseOptions,
      );
      const allowedExtensions = new Set([
        '2.5.29.19',
        '2.5.29.15',
        '2.5.29.37',
        '2.5.29.14',
        '2.5.29.35',
      ]);
      for (const cert of [parsed, parsedRoot]) {
        if (
          cert.signatureAlgorithm.name !== 'RSASSA-PKCS1-v1_5' ||
          cert.signatureAlgorithm.hash.name !== 'SHA-256' ||
          new Set(cert.extensions.map((extension) => extension.type)).size !==
            cert.extensions.length ||
          cert.extensions.some(
            (extension) =>
              extension.critical && !allowedExtensions.has(extension.type),
          )
        )
          throw new Error();
      }
      const constraints = parsed.getExtension(BasicConstraintsExtension);
      const usages = parsed.getExtension(KeyUsagesExtension);
      const rootUsages = parsedRoot.getExtension(KeyUsagesExtension);
      const extended = parsed.getExtension(ExtendedKeyUsageExtension);
      if (
        !constraints ||
        constraints.ca ||
        !constraints.critical ||
        !usages ||
        usages.usages !== KeyUsageFlags.digitalSignature ||
        !rootUsages ||
        !(rootUsages.usages & KeyUsageFlags.keyCertSign) ||
        extended?.usages.length !== 1 ||
        extended.usages[0] !== '1.3.6.1.5.5.7.3.2'
      )
        throw new Error();
      if (
        leaf.ca ||
        !root.ca ||
        !root.verify(root.publicKey) ||
        !leaf.checkIssued(root) ||
        !leaf.verify(root.publicKey) ||
        leaf.publicKey.asymmetricKeyType !== 'rsa' ||
        (leaf.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
        (leaf.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) > 4096 ||
        !leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.2')
      )
        throw new Error();
      // X.500 serialNumber is a QA profile choice, not an asserted SAT RFC rule.
      const marker = parsed.subjectName.getField('OU');
      if (marker.length !== 1 || marker[0] !== 'HEMIA SYNTHETIC EFIRMA V1')
        throw new Error();
      code = 'EFIRMA_RFC_MISMATCH';
      const identifiers = parsed.subjectName.getField('2.5.4.5');
      if (identifiers.length !== 1 || identifiers[0] !== rfc) throw new Error();
      code = 'EFIRMA_CERTIFICATE_EXPIRED';
      for (const cert of [root, leaf]) {
        if (
          !(
            Date.parse(cert.validFrom) <= Date.now() &&
            Date.parse(cert.validTo) > Date.now()
          )
        )
          throw new Error();
      }
      code = 'EFIRMA_KEY_PASSWORD_INVALID';
      let unprotected = false;
      try {
        createPrivateKey({ key: encryptedKey, format: 'der', type: 'pkcs8' });
        unprotected = true;
      } catch {
        /* Expected for protected PKCS8. */
      }
      if (unprotected) throw new Error();
      const key = createPrivateKey({
        key: encryptedKey,
        format: 'der',
        type: 'pkcs8',
        passphrase: password,
      });
      code = 'EFIRMA_KEY_MISMATCH';
      if (!leaf.checkPrivateKey(key)) throw new Error();
      return { key, certificate: leaf };
    } catch {
      throw efirmaError(code, 422);
    }
  }
}
