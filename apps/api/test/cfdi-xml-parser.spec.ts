import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import {
  CFDI_PARSER_VERSION,
  CFDI_SCHEMA_SET_VERSION,
  CfdiParserError,
  DEFAULT_CFDI_PARSER_OPTIONS,
  SaxesCfdiParserAdapter,
  type SaxesCfdiParserOptions,
} from '../src/modules/cfdi-parser';

const fixtureRoot = join(__dirname, 'fixtures', 'cfdi');
const schemaRoot = join(
  __dirname,
  '..',
  'src',
  'modules',
  'cfdi-parser',
  'schemas',
);

function fixture(name: string): string {
  return readFileSync(join(fixtureRoot, name), 'utf8');
}

function parser(
  overrides: Partial<SaxesCfdiParserOptions> = {},
): SaxesCfdiParserAdapter {
  return new SaxesCfdiParserAdapter({
    ...DEFAULT_CFDI_PARSER_OPTIONS,
    ...overrides,
  });
}

function stream(xml: string | Buffer, chunkSize = 37): Readable {
  const bytes = Buffer.isBuffer(xml) ? xml : Buffer.from(xml, 'utf8');
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, offset + chunkSize));
  }
  return Readable.from(chunks);
}

function duplicateFirstMatch(xml: string, pattern: RegExp): string {
  const match = pattern.exec(xml);
  if (!match) throw new Error('Synthetic fixture pattern did not match');
  return xml.replace(match[0], `${match[0]}\n${match[0]}`);
}

async function expectCode(
  promise: Promise<unknown>,
  code: CfdiParserError['code'],
  limit?: CfdiParserError['limit'],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code,
    ...(limit && { limit }),
  });
}

describe('SaxesCfdiParserAdapter', () => {
  it.each(['I', 'E', 'T'] as const)(
    'parses CFDI 4.0 type %s by namespace URI with exact decimal values',
    async (documentType) => {
      const xml = fixture('valid-ingreso.xml').replace(
        'TipoDeComprobante="I"',
        `TipoDeComprobante="${documentType}"`,
      );

      const result = await parser().parse(stream(xml, 11));

      expect(result).toMatchObject({
        parserVersion: CFDI_PARSER_VERSION,
        schemaVersion: CFDI_SCHEMA_SET_VERSION,
        sizeBytes: Buffer.byteLength(xml),
        document: {
          version: '4.0',
          documentType,
          subtotal: '100.000000',
          total: '116.000000',
          issuer: { rfc: 'AAA010101AAA' },
          receiver: { rfc: 'XAXX010101000' },
          stamp: {
            version: '1.1',
            uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        },
      });
      expect(result.document.concepts).toHaveLength(1);
      expect(result.document.concepts[0]).toMatchObject({
        quantity: '1.000000',
        unitValue: '100.000000',
        amount: '100.000000',
      });
      expect(result.document.concepts[0]?.taxes.lines[0]).toEqual({
        kind: 'transfer',
        base: '100.000000',
        tax: '002',
        factorType: 'Tasa',
        rateOrQuota: '0.160000',
        amount: '16.000000',
      });
      expect(result.document.taxes).toEqual({
        totalTransferred: '16.000000',
        lines: [
          {
            kind: 'transfer',
            base: '100.000000',
            tax: '002',
            factorType: 'Tasa',
            rateOrQuota: '0.160000',
            amount: '16.000000',
          },
        ],
      });
      expect(result.document.relations).toEqual([
        {
          relationGroupOrdinal: 1,
          relationOrdinal: 1,
          relationType: '04',
          relatedUuid: '11111111-1111-4111-8111-111111111111',
        },
        {
          relationGroupOrdinal: 1,
          relationOrdinal: 2,
          relationType: '04',
          relatedUuid: '22222222-2222-4222-8222-222222222222',
        },
        {
          relationGroupOrdinal: 2,
          relationOrdinal: 1,
          relationType: '01',
          relatedUuid: '33333333-3333-4333-8333-333333333333',
        },
      ]);
    },
  );

  it('extracts multiple Pagos 2.0 and multiple related documents', async () => {
    const result = await parser().parse(
      stream(fixture('valid-payment.xml'), 7),
    );

    expect(result.document.documentType).toBe('P');
    expect(result.document.payments).toMatchObject({
      version: '2.0',
      totals: {
        totalPayments: '174.00',
        totalTransferredVatBase16: '150.00',
        totalTransferredVatTax16: '24.00',
      },
    });
    expect(result.document.payments?.payments).toHaveLength(2);
    expect(
      result.document.payments?.payments[0]?.relatedDocuments,
    ).toHaveLength(2);
    expect(
      result.document.payments?.payments[1]?.relatedDocuments,
    ).toHaveLength(1);
    expect(
      result.document.payments?.payments.map((payment) => payment.paidAt),
    ).toEqual(['2026-08-31T13:00:00', '2026-09-01T09:00:00']);
    expect(result.document.payments?.payments[0]).toMatchObject({
      payerForeignBankName: 'BANCO EXTRANJERO SINTETICO',
      payerAccount: 'SYNTHETIC_01',
    });
    expect(result.document.payments?.payments[0]).not.toHaveProperty(
      'payerForeignAccount',
    );
    expect(
      result.document.payments?.payments[0]?.relatedDocuments[0]?.taxes
        .lines[0],
    ).toMatchObject({
      base: '50.000000',
      rateOrQuota: '0.160000',
      amount: '8.000000',
    });
  });

  it('extracts protected Nómina 1.2 core without converting decimals', async () => {
    const result = await parser().parse(
      stream(fixture('valid-payroll.xml'), 13),
    );

    expect(result.document.documentType).toBe('N');
    expect(result.document.payroll).toMatchObject({
      version: '1.2',
      payrollType: 'O',
      paymentDate: '2026-08-31',
      paidDays: '15.000',
      totalPerceptions: '1000.00',
      receiver: {
        employeeNumber: 'SYN-001',
        contributionBaseSalary: '66.66',
        integratedDailySalary: '70.00',
      },
      perceptions: [
        {
          taxableAmount: '900.00',
          exemptAmount: '100.00',
        },
      ],
      deductions: [{ amount: '100.00' }],
      otherPayments: [{ amount: '10.00', employmentSubsidy: '10.00' }],
      incapacities: [
        {
          days: '2',
          incapacityType: '01',
          amount: '50.00',
        },
      ],
    });
  });

  it('keeps a valid core and reports an unknown complement without inventing fields', async () => {
    const result = await parser().parse(
      stream(fixture('valid-unknown-complement.xml')),
    );

    expect(result.document.stamp.uuid).toBe(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    );
    expect(result.document.unsupportedComplements).toEqual([
      {
        namespaceUri: 'urn:balanz:synthetic:unsupported-complement',
        localName: 'Extension',
      },
    ]);
    expect(result.document).not.toHaveProperty('OpaqueField');
  });

  it.each([
    {
      name: 'missing required Exportacion',
      xml: () => fixture('valid-ingreso.xml').replace(' Exportacion="01"', ''),
    },
    {
      name: 'invalid Fecha lexical value',
      xml: () =>
        fixture('valid-ingreso.xml').replace(
          'Fecha="2026-08-15T12:30:00"',
          'Fecha="2026-99-99T77:30:00"',
        ),
    },
    {
      name: 'RegimenFiscal outside the SAT catalog',
      xml: () =>
        fixture('valid-ingreso.xml').replace(
          'RegimenFiscal="601"',
          'RegimenFiscal="999"',
        ),
    },
  ])('rejects XSD-invalid $name', async ({ xml }) => {
    await expectCode(parser().parse(stream(xml(), 17)), 'XML_MALFORMED');
  });

  it.each([
    {
      name: 'TFD 1.1 date',
      xml: () =>
        fixture('valid-ingreso.xml').replace(
          'FechaTimbrado="2026-08-15T12:31:00"',
          'FechaTimbrado="not-a-date"',
        ),
    },
    {
      name: 'Pagos 2.0 catalog',
      xml: () =>
        fixture('valid-payment.xml').replace(
          'FormaDePagoP="03"',
          'FormaDePagoP="ZZ"',
        ),
    },
    {
      name: 'Nomina 1.2 catalog',
      xml: () =>
        fixture('valid-payroll.xml').replace(
          'TipoNomina="O"',
          'TipoNomina="Z"',
        ),
    },
  ])(
    'validates the supported $name complement against local XSD',
    async ({ xml }) => {
      await expectCode(parser().parse(stream(xml(), 19)), 'XML_MALFORMED');
    },
  );

  it('resolves namespaces by URI rather than accepting a familiar prefix', async () => {
    const spoofed = fixture('valid-ingreso.xml').replace(
      'http://www.sat.gob.mx/cfd/4',
      'urn:synthetic:not-cfdi',
    );
    await expectCode(
      parser().parse(stream(spoofed)),
      'CFDI_VERSION_UNSUPPORTED',
    );
  });

  it('rejects unsupported CFDI, TFD, Pagos and Nómina versions with stable codes', async () => {
    await expectCode(
      parser().parse(
        stream(
          fixture('valid-ingreso.xml').replace(
            'Version="4.0"',
            'Version="3.3"',
          ),
        ),
      ),
      'CFDI_VERSION_UNSUPPORTED',
    );
    await expectCode(
      parser().parse(
        stream(
          fixture('valid-ingreso.xml').replace(
            '<stamp:TimbreFiscalDigital Version="1.1"',
            '<stamp:TimbreFiscalDigital Version="1.0"',
          ),
        ),
      ),
      'COMPLEMENT_UNSUPPORTED',
    );
    await expectCode(
      parser().parse(
        stream(
          fixture('valid-payment.xml').replace(
            '<p:Pagos Version="2.0"',
            '<p:Pagos Version="1.0"',
          ),
        ),
      ),
      'COMPLEMENT_UNSUPPORTED',
    );
    await expectCode(
      parser().parse(
        stream(
          fixture('valid-payroll.xml').replace(
            '<n:Nomina Version="1.2"',
            '<n:Nomina Version="1.1"',
          ),
        ),
      ),
      'COMPLEMENT_UNSUPPORTED',
    );
  });

  it('rejects malformed, truncated, invalid-decimal and invalid-UUID documents', async () => {
    const source = fixture('valid-ingreso.xml');
    await expectCode(
      parser().parse(stream(source.slice(0, -30))),
      'XML_MALFORMED',
    );
    await expectCode(
      parser().parse(stream(source.replace('</x:Conceptos>', '</x:Other>'))),
      'XML_MALFORMED',
    );
    await expectCode(
      parser().parse(
        stream(source.replace('Total="116.000000"', 'Total="1e2"')),
      ),
      'XML_MALFORMED',
    );
    await expectCode(
      parser().parse(
        stream(
          source.replace('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', 'NOT-A-UUID'),
        ),
      ),
      'CFDI_UUID_INVALID',
    );
  });

  it.each([
    {
      name: 'duplicate CFDI Emisor',
      xml: () =>
        duplicateFirstMatch(
          fixture('valid-ingreso.xml'),
          /<x:Emisor\b[^>]*\/>/,
        ),
    },
    {
      name: 'duplicate CFDI Receptor',
      xml: () =>
        duplicateFirstMatch(
          fixture('valid-ingreso.xml'),
          /<x:Receptor\b[\s\S]*?\/>/,
        ),
    },
    {
      name: 'duplicate CFDI Conceptos',
      xml: () =>
        duplicateFirstMatch(
          fixture('valid-ingreso.xml'),
          /<x:Conceptos>[\s\S]*?<\/x:Conceptos>/,
        ),
    },
    {
      name: 'duplicate CFDI Complemento',
      xml: () =>
        duplicateFirstMatch(
          fixture('valid-ingreso.xml'),
          /<x:Complemento>[\s\S]*?<\/x:Complemento>/,
        ),
    },
    {
      name: 'duplicate Pagos Totales',
      xml: () =>
        duplicateFirstMatch(
          fixture('valid-payment.xml'),
          /<p:Totales\b[\s\S]*?\/>/,
        ),
    },
    {
      name: 'duplicate Nomina Receptor',
      xml: () =>
        duplicateFirstMatch(
          fixture('valid-payroll.xml'),
          /<n:Receptor\b[\s\S]*?\/>/,
        ),
    },
  ])('rejects $name instead of overwriting parsed state', async ({ xml }) => {
    await expectCode(parser().parse(stream(xml(), 5)), 'XML_MALFORMED');
  });

  it.each([
    {
      name: 'out-of-order core children',
      xml: () => {
        const source = fixture('valid-ingreso.xml');
        const emisor = /<x:Emisor\b[^>]*\/>/.exec(source)?.[0];
        const receptor = /<x:Receptor\b[\s\S]*?\/>/.exec(source)?.[0];
        if (!emisor || !receptor) {
          throw new Error('Synthetic fixture pattern did not match');
        }
        return source
          .replace(emisor, '__SYNTHETIC_EMISOR__')
          .replace(receptor, emisor)
          .replace('__SYNTHETIC_EMISOR__', receptor);
      },
    },
    {
      name: 'unknown element in the CFDI core',
      xml: () =>
        fixture('valid-ingreso.xml').replace(
          '<x:Complemento>',
          '<x:Unexpected/><x:Complemento>',
        ),
    },
    {
      name: 'empty CfdiRelacionados group',
      xml: () =>
        fixture('valid-ingreso.xml').replace(
          /<x:CfdiRelacionados TipoRelacion="04">[\s\S]*?<\/x:CfdiRelacionados>/,
          '<x:CfdiRelacionados TipoRelacion="04"></x:CfdiRelacionados>',
        ),
    },
    {
      name: 'Pago without DoctoRelacionado',
      xml: () =>
        fixture('valid-payment.xml').replace(
          /<p:Pago FechaPago="2026-08-31T13:00:00"[\s\S]*?<\/p:Pago>/,
          '<p:Pago FechaPago="2026-08-31T13:00:00" FormaDePagoP="03" MonedaP="MXN" Monto="116.000000"></p:Pago>',
        ),
    },
  ])('rejects structurally invalid $name', async ({ xml }) => {
    await expectCode(parser().parse(stream(xml(), 7)), 'XML_MALFORMED');
  });

  it.each([
    {
      name: 'DOCTYPE',
      markup: '<!DOCTYPE Comprobante>',
    },
    {
      name: 'XXE',
      markup:
        '<!DOCTYPE Comprobante [<!ENTITY xxe SYSTEM "file:///synthetic/secret">]>',
    },
    {
      name: 'entity expansion',
      markup:
        '<!DOCTYPE Comprobante [<!ENTITY a "A"><!ENTITY b "&a;&a;&a;&a;">]>',
    },
  ])('rejects $name before semantic parsing', async ({ markup }) => {
    const xml = fixture('valid-ingreso.xml').replace('?>', `?>${markup}`);
    await expectCode(parser().parse(stream(xml, 3)), 'XML_SECURITY_VIOLATION');
  });

  it('detects a forbidden declaration split across stream chunks', async () => {
    const source = fixture('valid-ingreso.xml');
    const declarationEnd = source.indexOf('?>') + 2;
    const rest = source.slice(declarationEnd);
    const split = Readable.from([
      Buffer.from(source.slice(0, declarationEnd)),
      Buffer.from('<!DOC'),
      Buffer.from('TYPE Comprobante>'),
      Buffer.from(rest),
    ]);
    await expectCode(parser().parse(split), 'XML_SECURITY_VIOLATION');
  });

  it('rejects XInclude and processing instructions while never resolving schema URLs', async () => {
    const source = fixture('valid-ingreso.xml');
    const xinclude = source.replace(
      '<x:Complemento>',
      '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///synthetic/secret"/><x:Complemento>',
    );
    await expectCode(
      parser().parse(stream(xinclude)),
      'XML_SECURITY_VIOLATION',
    );

    const processingInstruction = source.replace(
      '?>',
      '?><?xml-stylesheet href="https://example.invalid/external.xsl"?>',
    );
    await expectCode(
      parser().parse(stream(processingInstruction)),
      'XML_SECURITY_VIOLATION',
    );

    const schemaLocation = source.replace(
      '<x:Comprobante ',
      '<x:Comprobante xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 https://example.invalid/never-fetched.xsd" ',
    );
    await expect(parser().parse(stream(schemaLocation))).resolves.toMatchObject(
      {
        document: { version: '4.0' },
      },
    );
  });

  it.each([
    ['bytes', { maxBytes: 64 }],
    ['depth', { maxDepth: 3 }],
    ['nodes', { maxNodes: 5 }],
    ['attributes', { maxAttributes: 20, maxAttributesPerElement: 20 }],
    [
      'attributes_per_element',
      { maxAttributes: 100, maxAttributesPerElement: 3 },
    ],
    ['text_node_bytes', { maxTextNodeBytes: 2 }],
  ] as const)(
    'enforces the %s limit during streaming',
    async (limit, overrides) => {
      const instance = parser(overrides);
      const expectedCode =
        limit === 'bytes'
          ? 'INGESTION_FILE_TOO_LARGE'
          : 'XML_SECURITY_VIOLATION';
      await expectCode(
        instance.parse(stream(fixture('valid-ingreso.xml'), 5)),
        expectedCode,
        limit,
      );
    },
  );

  it('enforces parse time with a deterministic monotonic clock', async () => {
    let now = 0;
    const instance = parser({
      parseTimeoutMs: 3,
      clock: () => {
        now += 2;
        return now;
      },
    });
    await expectCode(
      instance.parse(stream(fixture('valid-ingreso.xml'))),
      'XML_SECURITY_VIOLATION',
      'time',
    );
  });

  it('terminates a stalled input stream at the wall-clock deadline', async () => {
    const stalled = new PassThrough();
    const source = fixture('valid-ingreso.xml');
    stalled.write(Buffer.from(source.slice(0, source.indexOf('<x:Emisor'))));

    await expectCode(
      parser({ parseTimeoutMs: 20 }).parse(stalled),
      'XML_SECURITY_VIOLATION',
      'time',
    );
    expect(stalled.destroyed).toBe(true);
  });

  it('accepts UTF-8 BOM but rejects UTF-16 and unsupported declared encodings', async () => {
    const source = fixture('valid-ingreso.xml');
    const utf8Bom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(source),
    ]);
    await expect(parser().parse(stream(utf8Bom, 1))).resolves.toMatchObject({
      document: { version: '4.0' },
    });

    await expectCode(
      parser().parse(stream(Buffer.from(`\ufeff${source}`, 'utf16le'))),
      'XML_SECURITY_VIOLATION',
    );
    await expectCode(
      parser().parse(
        stream(source.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')),
      ),
      'XML_SECURITY_VIOLATION',
    );

    const invalidUtf8 = Buffer.concat([
      Buffer.from(source.slice(0, source.indexOf('<x:Emisor'))),
      Buffer.from([0xc3, 0x28]),
      Buffer.from(source.slice(source.indexOf('<x:Emisor'))),
    ]);
    await expectCode(
      parser().parse(stream(invalidUtf8, 1)),
      'XML_SECURITY_VIOLATION',
    );
  });

  it('honors worker cancellation and returns only safe error text', async () => {
    const controller = new AbortController();
    controller.abort();
    await expectCode(
      parser().parse(stream(fixture('valid-ingreso.xml')), {
        signal: controller.signal,
      }),
      'PARSER_ABORTED',
    );

    const inFlightController = new AbortController();
    const inFlight = parser().parse(
      stream(fixture('valid-ingreso.xml'), Number.MAX_SAFE_INTEGER),
      { signal: inFlightController.signal },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    inFlightController.abort();
    await expectCode(inFlight, 'PARSER_ABORTED');

    const canary = 'SYNTHETIC-XML-CANARY-MUST-NOT-LEAK';
    const malformed = `<root secret="${canary}">`;
    try {
      await parser().parse(stream(malformed));
      throw new Error('Expected parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CfdiParserError);
      expect((error as Error).message).not.toContain(canary);
      expect(JSON.stringify(error)).not.toContain(canary);
    }

    const xsdCanary = 'SYNTHETIC-XSD-CANARY-MUST-NOT-LEAK';
    try {
      await parser().parse(
        stream(
          fixture('valid-ingreso.xml').replace(
            'RegimenFiscal="601"',
            `RegimenFiscal="${xsdCanary}"`,
          ),
        ),
      );
      throw new Error('Expected XSD validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CfdiParserError);
      expect(error).toMatchObject({ code: 'XML_MALFORMED' });
      expect((error as Error).message).not.toContain(xsdCanary);
      expect(JSON.stringify(error)).not.toContain(xsdCanary);
    }
  });

  it('rejects attempts to raise any normative parser ceiling', () => {
    expect(() => parser({ maxBytes: 5 * 1024 * 1024 + 1 })).toThrow(
      'Unsafe CFDI parser option',
    );
    expect(() => parser({ maxDepth: 65 })).toThrow('Unsafe CFDI parser option');
    expect(() =>
      parser({ maxAttributes: 10, maxAttributesPerElement: 11 }),
    ).toThrow('Invalid CFDI parser attribute limits');
  });
});

describe('official CFDI schema manifest', () => {
  it('pins every bundled official SAT schema by byte length and SHA-256', () => {
    const manifest = JSON.parse(
      readFileSync(join(schemaRoot, 'manifest.json'), 'utf8'),
    ) as {
      schemaSetVersion: string;
      runtimeNetworkAccess: boolean;
      schemas: Array<{
        file: string;
        officialUrl: string;
        sha256: string;
        sizeBytes: number;
      }>;
    };

    expect(manifest.schemaSetVersion).toBe(CFDI_SCHEMA_SET_VERSION);
    expect(manifest.runtimeNetworkAccess).toBe(false);
    expect(manifest.schemas).toHaveLength(8);
    for (const schema of manifest.schemas) {
      expect(schema.officialUrl).toMatch(/^https:\/\/www\.sat\.gob\.mx\//);
      const bytes = readFileSync(join(schemaRoot, schema.file));
      expect(bytes.length).toBe(schema.sizeBytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        schema.sha256,
      );
    }
  });

  it('contains no runtime downloader in the parser module', () => {
    const source = readFileSync(
      join(
        schemaRoot,
        '..',
        'adapters',
        'saxes',
        'saxes-cfdi-parser.adapter.ts',
      ),
      'utf8',
    );
    expect(source).not.toMatch(/\bfetch\s*\(|https?\.request|axios|parseFloat/);
  });

  it('bundles every transitive schema import referenced by the supported XSDs', () => {
    const bundled = new Set(
      (
        JSON.parse(readFileSync(join(schemaRoot, 'manifest.json'), 'utf8')) as {
          schemas: Array<{ file: string }>;
        }
      ).schemas.map((schema) => schema.file),
    );

    for (const file of [
      'cfdv40.xsd',
      'TimbreFiscalDigitalv11.xsd',
      'Pagos20.xsd',
      'nomina12.xsd',
    ]) {
      const xsd = readFileSync(join(schemaRoot, file), 'utf8');
      for (const match of xsd.matchAll(/schemaLocation="[^"]*\/([^/"]+)"/g)) {
        expect(bundled).toContain(match[1]);
      }
    }
  });
});
