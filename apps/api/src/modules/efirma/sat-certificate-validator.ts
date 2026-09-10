import { X509Certificate, type KeyObject, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Certificate, CertificateChainValidationEngine } from 'pkijs';
import {
  X509Certificate as StructuredCertificate,
  BasicConstraintsExtension,
  KeyUsagesExtension,
  KeyUsageFlags,
} from '@peculiar/x509';
import {
  boundedDer,
  openProtectedKey,
  pkcs8Preflight,
} from './pkcs8-preflight';
import { efirmaError } from './efirma.errors';
interface TrustCertificate {
  derBase64: string;
  sha256: string;
  sourceUrl: string;
}
interface GenerationRule {
  id: string;
  issuerSha256: string;
  policyOid: string;
  keyUsages: number;
  criticalExtensions: string[];
  evidenceUrl: string;
}
export interface SatTrustBundle {
  profile: 'sat_efirma_v1';
  version: string;
  roots: TrustCertificate[];
  intermediates: TrustCertificate[];
  generations: GenerationRule[];
}
/** Offline validation implementation. No SAT generation is bundled or implicitly trusted. */
export class SatCertificateValidator {
  constructor(private readonly bundlePath: string) {}
  async validate(
    certificate: Buffer,
    encryptedKey: Buffer,
    password: Buffer,
    rfc: string,
  ): Promise<{ key: KeyObject; certificate: X509Certificate }> {
    let code = 'EFIRMA_CERTIFICATE_PROFILE_REJECTED';
    try {
      if (password.length < 1 || password.length > 1024) throw new Error();
      const schema = boundedDer(certificate);
      pkcs8Preflight(encryptedKey);
      const data = await readFile(this.bundlePath);
      if (data.length > 256 * 1024) throw new Error();
      const bundle = JSON.parse(data.toString('utf8')) as SatTrustBundle;
      if (
        bundle.profile !== 'sat_efirma_v1' ||
        !/^[-a-zA-Z0-9._]{1,64}$/.test(bundle.version) ||
        !Array.isArray(bundle.roots) ||
        !bundle.roots.length ||
        bundle.roots.length > 8 ||
        !Array.isArray(bundle.intermediates) ||
        bundle.intermediates.length > 8 ||
        !Array.isArray(bundle.generations) ||
        !bundle.generations.length ||
        bundle.generations.length > 16
      )
        throw new Error();
      const official = (url: string) => {
        const u = new URL(url);
        return (
          u.protocol === 'https:' &&
          !u.username &&
          !u.password &&
          (u.hostname === 'sat.gob.mx' ||
            u.hostname.endsWith('.sat.gob.mx') ||
            u.hostname === 'dof.gob.mx')
        );
      };
      const load = (entry: TrustCertificate) => {
        const bytes = Buffer.from(entry.derBase64, 'base64');
        if (
          createHash('sha256').update(bytes).digest('hex') !== entry.sha256 ||
          !official(entry.sourceUrl)
        )
          throw new Error();
        const cert = new Certificate({ schema: boundedDer(bytes) });
        const native = new X509Certificate(bytes);
        if (
          !native.ca ||
          native.publicKey.asymmetricKeyType !== 'rsa' ||
          ![2048, 3072, 4096].includes(
            native.publicKey.asymmetricKeyDetails?.modulusLength ?? 0,
          ) ||
          cert.signatureAlgorithm.algorithmId !== '1.2.840.113549.1.1.11'
        )
          throw new Error();
        return { cert, native, hash: entry.sha256 };
      };
      const roots = bundle.roots.map(load),
        intermediates = bundle.intermediates.map(load);
      const leaf = new X509Certificate(certificate),
        parsed = new StructuredCertificate(Uint8Array.from(certificate), {
          berOptions: { maxDepth: 16, maxNodes: 512, maxContentLength: 16384 },
        });
      if (
        leaf.ca ||
        leaf.publicKey.asymmetricKeyType !== 'rsa' ||
        ![2048, 3072, 4096].includes(
          leaf.publicKey.asymmetricKeyDetails?.modulusLength ?? 0,
        )
      )
        throw new Error();
      for (const native of [
        leaf,
        ...roots.map((r) => r.native),
        ...intermediates.map((r) => r.native),
      ])
        if (
          Date.parse(native.validFrom) > Date.now() ||
          Date.parse(native.validTo) <= Date.now()
        )
          throw new Error();
      for (const root of roots)
        if (!root.native.verify(root.native.publicKey)) throw new Error();
      const chain = new CertificateChainValidationEngine({
        trustedCerts: roots.map((r) => r.cert),
        certs: [
          ...intermediates.map((r) => r.cert),
          new Certificate({ schema }),
        ],
        checkDate: new Date(),
      });
      if (!(await chain.verify()).result) throw new Error();
      const issuer = [...intermediates, ...roots].find(
        (r) => leaf.checkIssued(r.native) && leaf.verify(r.native.publicKey),
      );
      if (!issuer) throw new Error();
      const rule = bundle.generations.find(
        (r) => r.issuerSha256 === issuer.hash,
      );
      if (
        !rule ||
        !official(rule.evidenceUrl) ||
        !/^\d+(?:\.\d+)+$/.test(rule.policyOid)
      )
        throw new Error();
      const certModel = new Certificate({ schema });
      const policies = certModel.extensions?.find(
        (e) => e.extnID === '2.5.29.32',
      )?.parsedValue as
        | { certificatePolicies?: { policyIdentifier: string }[] }
        | undefined;
      if (
        !policies?.certificatePolicies?.some(
          (p) => p.policyIdentifier === rule.policyOid,
        )
      )
        throw new Error();
      const constraints = parsed.getExtension(BasicConstraintsExtension),
        usage = parsed.getExtension(KeyUsagesExtension);
      if (
        !constraints ||
        constraints.ca ||
        !usage ||
        Number(usage.usages) !== rule.keyUsages ||
        !(usage.usages & KeyUsageFlags.digitalSignature) ||
        parsed.signatureAlgorithm.name !== 'RSASSA-PKCS1-v1_5' ||
        parsed.signatureAlgorithm.hash.name !== 'SHA-256'
      )
        throw new Error();
      if (
        new Set(parsed.extensions.map((e) => e.type)).size !==
          parsed.extensions.length ||
        parsed.extensions.some(
          (e) => e.critical && !rule.criticalExtensions.includes(e.type),
        )
      )
        throw new Error();
      // X.500 uniqueIdentifier: DOF profile documents RFC. Additional representative identifiers are not silently substituted.
      code = 'EFIRMA_RFC_MISMATCH';
      const ids = parsed.subjectName.getField('2.5.4.45');
      if (ids.length !== 1 || ids[0] !== rfc) throw new Error();
      code = 'EFIRMA_KEY_PASSWORD_INVALID';
      const key = await openProtectedKey(encryptedKey, password);
      code = 'EFIRMA_KEY_MISMATCH';
      if (!leaf.checkPrivateKey(key)) throw new Error();
      return { key, certificate: leaf };
    } catch {
      throw efirmaError(code, 422);
    }
  }
}
