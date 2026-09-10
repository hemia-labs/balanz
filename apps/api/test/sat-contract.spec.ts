import { createPrivateKey, X509Certificate } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import { Readable } from 'node:stream';
import { syntheticCredential } from './fixtures/efirma-fixture';
import {
  signSatOperation,
  signSatAuthentication,
} from '../src/modules/sat-download/sat-soap';
import {
  SAT,
  SOAP,
  classifyVerification,
  type SatOperation,
} from '../src/modules/sat-download/sat-contract';
import {
  decodeSoapPackage,
  Base64Decoder,
} from '../src/modules/sat-download/soap-package-stream';
import {
  pkcs8Preflight,
  openProtectedKey,
  PKCS8_LIMITS,
} from '../src/modules/efirma/pkcs8-preflight';
import {
  parseMetadata,
  METADATA_HEADER,
} from '../src/modules/sat-download/metadata-parser';
describe('SAT bounded contracts', () => {
  let fixture: Awaited<ReturnType<typeof syntheticCredential>>;
  let key: ReturnType<typeof createPrivateKey>;
  let cert: X509Certificate;
  beforeAll(async () => {
    fixture = await syntheticCredential();
    key = createPrivateKey({
      key: fixture.encryptedKey,
      format: 'der',
      type: 'pkcs8',
      passphrase: fixture.password,
    });
    cert = new X509Certificate(fixture.certificate);
  });
  afterAll(() => fixture.password.fill(0));
  it.each([
    'SolicitaDescargaEmitidos',
    'SolicitaDescargaRecibidos',
    'SolicitaDescargaFolio',
    'VerificaSolicitudDescarga',
    'PeticionDescargaMasivaTercerosEntrada',
  ] as Exclude<SatOperation, 'Autentica'>[])(
    'verifies the actual signed payload of %s and rejects tampering',
    (op) => {
      const xml = signSatOperation(
        op,
        { RfcSolicitante: 'AAA010101AAA', IdSolicitud: 'folio' },
        key,
        cert,
      );
      const element =
        op === 'PeticionDescargaMasivaTercerosEntrada'
          ? 'peticionDescarga'
          : 'solicitud';
      const payload = xml.slice(
        xml.indexOf('<' + element + ' '),
        xml.indexOf('</' + element + '>') + element.length + 3,
      );
      const sig = payload.match(/<Signature[\s\S]*?<\/Signature>/)![0];
      const verifier = new SignedXml({
        publicCert: cert.toString(),
        getCertFromKeyInfo: () => null,
      });
      verifier.loadSignature(sig);
      expect(verifier.checkSignature(payload)).toBe(true);
      expect(verifier.getSignedReferences()).toHaveLength(1);
      expect(verifier.getSignedReferences()[0]).toContain(
        'RfcSolicitante="AAA010101AAA"',
      );
      expect(verifier.getReferences()[0].uri).toBe('');
      expect(
        verifier.checkSignature(
          payload.replace('AAA010101AAA', 'BBB010101BBB'),
        ),
      ).toBe(false);
    },
  );
  it('authentication signs Timestamp by WS-Security ID, not an arbitrary unsigned node', () => {
    const now = new Date(),
      xml = signSatAuthentication(
        key,
        cert,
        now,
        new Date(now.getTime() + 300000),
      );
    const verifier = new SignedXml({
      publicCert: cert.toString(),
      getCertFromKeyInfo: () => null,
      idMode: 'wssecurity',
    });
    verifier.loadSignature(xml.match(/<Signature[\s\S]*?<\/Signature>/)![0]);
    expect(verifier.checkSignature(xml)).toBe(true);
    expect(verifier.getReferences()[0].uri).toBe('#_0');
    expect(verifier.getSignedReferences()[0]).toContain(now.toISOString());
    expect(
      verifier.checkSignature(
        xml.replace(now.toISOString(), '2000-01-01T00:00:00.000Z'),
      ),
    ).toBe(false);
  });
  it('preflights protected PKCS8 and opens only a matching password', async () => {
    expect(pkcs8Preflight(fixture.encryptedKey).iterations).toBeLessThanOrEqual(
      PKCS8_LIMITS.iterations,
    );
    expect(
      cert.checkPrivateKey(
        await openProtectedKey(fixture.encryptedKey, fixture.password),
      ),
    ).toBe(true);
    await expect(
      openProtectedKey(fixture.encryptedKey, Buffer.from('wrong')),
    ).rejects.toThrow();
  });
  it('rejects trailing DER and unprotected PKCS8 before expensive work', () => {
    expect(() =>
      pkcs8Preflight(Buffer.concat([fixture.encryptedKey, Buffer.from([0])])),
    ).toThrow();
    expect(() =>
      pkcs8Preflight(key.export({ format: 'der', type: 'pkcs8' })),
    ).toThrow();
  });
  it('bounds concurrent key openings', async () => {
    const attempts = await Promise.allSettled(
      [1, 2, 3].map(() =>
        openProtectedKey(fixture.encryptedKey, fixture.password),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(2);
  });
  const envelope = (value: string) =>
    '<s:Envelope xmlns:s="' +
    SOAP +
    '"><s:Header><respuesta xmlns="' +
    SAT +
    '" CodEstatus="5000"/></s:Header><s:Body><RespuestaDescargaMasivaTercerosSalida xmlns="' +
    SAT +
    '"><Paquete>' +
    value +
    '</Paquete></RespuestaDescargaMasivaTercerosSalida></s:Body></s:Envelope>';
  async function decode(xml: string) {
    const chunks: Buffer[] = [];
    for await (const p of decodeSoapPackage(
      Readable.from(Array.from(Buffer.from(xml), (b) => Buffer.from([b]))),
    ))
      chunks.push(p);
    return Buffer.concat(chunks);
  }
  it('decodes SOAP/base64 across every byte boundary', async () => {
    const bytes = Buffer.from('private synthetic ZIP bytes');
    expect(await decode(envelope(bytes.toString('base64')))).toEqual(bytes);
  });
  it.each(['Zg=', 'Zh==', 'Zg==YQ==', '!!!!'])(
    'rejects noncanonical base64 %s',
    async (value) => {
      await expect(decode(envelope(value))).rejects.toThrow();
    },
  );
  it.each([
    envelope('Zg==').replace('5000', '5008'),
    envelope('Zg==').replace('</s:Envelope>', ''),
    envelope('Zg==').replace('<Paquete>', '<Other>'),
    envelope('Zg==').replace('<s:Envelope', '<!DOCTYPE a><s:Envelope'),
  ])('rejects malformed or rejected SOAP', async (xml) => {
    await expect(decode(xml)).rejects.toThrow();
  });
  it('rejects extra data after a padded quantum', () => {
    const d = new Base64Decoder();
    d.write('Zg==');
    expect(() => d.write('YQ==')).toThrow();
  });
  it('does not treat 5004 or contradictory zero counts as empty', () => {
    expect(
      classifyVerification({
        code: '5004',
        state: 3,
        requestCode: '5000',
        count: 0,
        packages: [],
      }),
    ).toBe('failed');
    expect(
      classifyVerification({
        code: '5000',
        state: 3,
        requestCode: '5000',
        count: 0,
        packages: ['id'],
      }),
    ).toBe('contradictory');
    expect(
      classifyVerification({
        code: '5000',
        state: 2,
        requestCode: '5000',
        count: 0,
        packages: [],
      }),
    ).toBe('waiting');
  });
  it('parses typed metadata incrementally without generating CFDI', async () => {
    const txt =
      METADATA_HEADER.join('~') +
      '\n' +
      '12345678-1234-1234-1234-123456789ABC~AAA010101AAA~Issuer~BBB010101BBB~Receiver~CCC010101CCC~2026-01-01T00:00:00~2026-01-01T00:00:01~1.50~I~1~\n';
    const rows: Awaited<
      ReturnType<ReturnType<typeof parseMetadata>['next']>
    >['value'][] = [];
    for await (const row of parseMetadata(
      Readable.from(Array.from(Buffer.from(txt), (b) => Buffer.from([b]))),
    ))
      rows.push(row);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ total: '1.50', status: 'active' });
    expect(rows[0]).not.toHaveProperty('issuerName');
  });
});
