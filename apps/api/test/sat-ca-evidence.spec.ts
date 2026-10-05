import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { X509Certificate, createHash } from 'node:crypto';
import { fromBuffer, type Entry } from 'yauzl';
import { loadSatAuthority } from '../src/modules/efirma/sat-certificate-validator';
const officialUrl =
  'https://wwwmat.sat.gob.mx/cs/Satellite?blobcol=urldata&blobkey=id&blobtable=MungoBlobs&blobwhere=1461175745719&ssbinary=true';
describe('public SAT CA evidence, not e.firma acceptance', () => {
  const certificates = new Map<string, Buffer>();
  beforeAll(async () => {
    const archive = readFileSync(
      join(
        __dirname,
        '../../../docs/contracts/sat-v1.5/sat-public-ca-20260915.zip',
      ),
    );
    expect(createHash('sha256').update(archive).digest('hex')).toBe(
      'c58f3fe92e23d1c82cee46e8b2356b69b0e216b23bbec86eefdc280822ad6af7',
    );
    await new Promise<void>((resolve, reject) =>
      fromBuffer(archive, { lazyEntries: true }, (error, zip) => {
        if (error || !zip)
          return reject(error ?? new Error('missing ZIP stream'));
        zip.on('error', reject);
        zip.on('end', resolve);
        zip.on('entry', (entry: Entry) => {
          if (
            !/\.(cer|crt)$/.test(entry.fileName) ||
            entry.uncompressedSize > 16384
          ) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream)
              return reject(error ?? new Error('missing ZIP stream'));
            const chunks: Buffer[] = [];
            stream.on('data', (b: Buffer) => chunks.push(b));
            stream.on('error', reject);
            stream.on('end', () => {
              certificates.set(
                entry.fileName,
                new X509Certificate(Buffer.concat(chunks)).raw,
              );
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      }),
    );
  });
  const load = (name: string) => {
    const der = certificates.get('Cert_Prod/' + name)!;
    return loadSatAuthority({
      derBase64: der.toString('base64'),
      sha256: createHash('sha256').update(der).digest('hex'),
      sourceUrl: officialUrl,
    });
  };
  it('admits documented SHA512 RSA CA signatures and verifies the public AC6 chain', () => {
    const root = load('ARC6_IES.crt'),
      intermediate = load('AC6_SAT.crt');
    expect(root.hash).toBe(
      'a86baf49b2e91d0141722c4e7026ab246183a8072926e9983edbd4e5ba72515d',
    );
    expect(intermediate.hash).toBe(
      '054e8f213ff2228254d8f87ec43d2e7c2eda628d927c270b9a77d1d09eef9418',
    );
    expect(root.native.verify(root.native.publicKey)).toBe(true);
    expect(
      intermediate.native.checkIssued(root.native) &&
        intermediate.native.verify(root.native.publicKey),
    ).toBe(true);
  });
  it('does not accept an issuer by name or admit legacy SHA1/MD5', () => {
    expect(
      load('AC6_SAT.crt').native.verify(load('ARC5_IES.cer').native.publicKey),
    ).toBe(false);
    expect(() => load('AC1_SAT.cer')).toThrow();
    expect(() => load('AC0_SAT.cer')).toThrow();
  });
  it('pins DER bytes and refuses an unrelated source', () => {
    const derBase64 = certificates
      .get('Cert_Prod/AC6_SAT.crt')!
      .toString('base64');
    expect(() =>
      loadSatAuthority({
        derBase64,
        sha256: '0'.repeat(64),
        sourceUrl: officialUrl,
      }),
    ).toThrow();
    expect(() =>
      loadSatAuthority({
        derBase64,
        sha256: load('AC6_SAT.crt').hash,
        sourceUrl: 'https://example.invalid/ca',
      }),
    ).toThrow();
  });
});
