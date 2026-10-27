import type { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';
import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from 'saxes';
import { validateCfdi40Xsd } from '../xmllint/local-cfdi-xsd.validator';
import {
  CfdiParserError,
  isCfdiParserError,
  type CfdiParserLimit,
} from '../../cfdi-parser.errors';
import {
  CFDI_40_NAMESPACE,
  CFDI_PARSER_VERSION,
  CFDI_SCHEMA_SET_VERSION,
  PAYMENTS_20_NAMESPACE,
  PAYROLL_12_NAMESPACE,
  TFD_11_NAMESPACE,
  type CfdiConcept,
  type CfdiDocumentType,
  type CfdiParseOptions,
  type CfdiParseResult,
  type CfdiParserPort,
  type CfdiPayment,
  type CfdiPaymentDocument,
  type CfdiPaymentsComplement,
  type CfdiPayrollComplement,
  type CfdiPayrollOtherPayment,
  type CfdiRelation,
  type CfdiStamp,
  type CfdiTaxes,
  type ParsedCfdi,
  type UnsupportedCfdiComplement,
} from '../../ports/cfdi-parser.port';

const ABSOLUTE_XML_MAX_BYTES = 5 * 1024 * 1024;
const XINCLUDE_NAMESPACE = 'http://www.w3.org/2001/XInclude';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const FORBIDDEN_MARKUP = /<!\s*(?:DOCTYPE|ENTITY)\b/i;
const ALLOWED_DOCUMENT_TYPES = new Set<CfdiDocumentType>([
  'I',
  'E',
  'T',
  'N',
  'P',
]);

export interface SaxesCfdiParserOptions {
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxAttributes: number;
  maxAttributesPerElement: number;
  maxTextNodeBytes: number;
  parseTimeoutMs: number;
  /** Test seam only; production callers should omit it. */
  clock?: () => number;
}

export const DEFAULT_CFDI_PARSER_OPTIONS: Readonly<SaxesCfdiParserOptions> = {
  maxBytes: ABSOLUTE_XML_MAX_BYTES,
  maxDepth: 64,
  maxNodes: 200_000,
  maxAttributes: 100_000,
  maxAttributesPerElement: 128,
  maxTextNodeBytes: 1024 * 1024,
  parseTimeoutMs: 5_000,
};

interface RootFields {
  version?: '4.0';
  series?: string;
  folio?: string;
  issuedAt?: string;
  paymentForm?: string;
  certificateNumber?: string;
  certificate?: string;
  subtotal?: string;
  discount?: string;
  currency?: string;
  exchangeRate?: string;
  total?: string;
  documentType?: CfdiDocumentType;
  exportCode?: string;
  paymentMethod?: string;
  issueLocation?: string;
  confirmation?: string;
}

type PayrollBuilder = Omit<CfdiPayrollComplement, 'receiver'> & {
  receiver?: CfdiPayrollComplement['receiver'];
};

type PaymentsBuilder = Omit<CfdiPaymentsComplement, 'totals'> & {
  totals?: CfdiPaymentsComplement['totals'];
};

/**
 * Hardened SAX boundary with structural, local XSD and semantic validation for
 * the supported Phase 1 subset. It retains at most the configured 5 MiB input
 * while the isolated XSD worker validates it and never resolves remote assets.
 */
export class SaxesCfdiParserAdapter implements CfdiParserPort {
  private readonly options: SaxesCfdiParserOptions;
  private readonly clock: () => number;

  constructor(options: SaxesCfdiParserOptions = DEFAULT_CFDI_PARSER_OPTIONS) {
    this.options = validateOptions(options);
    this.clock = options.clock ?? Date.now;
  }

  async parse(
    input: Readable,
    parseOptions: CfdiParseOptions = {},
  ): Promise<CfdiParseResult> {
    if (parseOptions.signal?.aborted) throw abortedError();

    const startedAt = this.clock();
    const accumulator = new CfdiAccumulator();
    const guard = new ParserResourceGuard(this.options, startedAt, this.clock);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const parser = this.createParser(accumulator, guard);
    let sizeBytes = 0;
    let forbiddenTail = '';
    let encodingProbe = Buffer.alloc(0);
    let decoderStarted = false;
    let timedOut = false;
    let aborted = false;
    const xmlChunks: Buffer[] = [];
    const xsdAbortController = new AbortController();

    const stopForTimeout = () => {
      timedOut = true;
      xsdAbortController.abort();
      input.destroy();
    };
    const stopForAbort = () => {
      aborted = true;
      xsdAbortController.abort();
      input.destroy();
    };
    const timeout = setTimeout(stopForTimeout, this.options.parseTimeoutMs);
    timeout.unref();
    parseOptions.signal?.addEventListener('abort', stopForAbort, {
      once: true,
    });

    const feed = (bytes: Buffer): void => {
      guard.checkTime();
      const scanned = `${forbiddenTail}${bytes.toString('latin1')}`;
      if (FORBIDDEN_MARKUP.test(scanned)) throw securityError();
      forbiddenTail = scanned.slice(-32);
      const decoded = decodeUtf8(decoder, bytes, true);
      if (decoded.length > 0) parser.write(decoded);
      guard.checkTime();
    };

    try {
      for await (const chunk of input) {
        if (timedOut) throw limitError('time');
        if (aborted || parseOptions.signal?.aborted) throw abortedError();

        const bytes = toBuffer(chunk);
        sizeBytes += bytes.length;
        if (sizeBytes > this.options.maxBytes) throw fileTooLargeError();
        xmlChunks.push(Buffer.from(bytes));

        if (!decoderStarted) {
          encodingProbe = Buffer.concat([encodingProbe, bytes]);
          if (encodingProbe.length < 4) continue;
          assertUtf8Encoding(encodingProbe);
          decoderStarted = true;
          feed(encodingProbe);
          encodingProbe = Buffer.alloc(0);
          continue;
        }
        feed(bytes);
      }

      if (timedOut) throw limitError('time');
      if (aborted || parseOptions.signal?.aborted) throw abortedError();
      if (!decoderStarted) {
        assertUtf8Encoding(encodingProbe);
        feed(encodingProbe);
      }
      const finalText = decodeUtf8(decoder, undefined, false);
      if (finalText.length > 0) parser.write(finalText);
      parser.close();
      guard.checkTime();

      const document = accumulator.finish();
      const schemaValid = await validateCfdi40Xsd(
        Buffer.concat(xmlChunks, sizeBytes),
        xsdAbortController.signal,
      );
      if (!schemaValid) throw malformedError();
      guard.checkTime();

      return {
        parserVersion: CFDI_PARSER_VERSION,
        schemaVersion: CFDI_SCHEMA_SET_VERSION,
        sizeBytes,
        document,
      };
    } catch (error) {
      input.destroy();
      if (timedOut) throw limitError('time');
      if (aborted || parseOptions.signal?.aborted) throw abortedError();
      if (isCfdiParserError(error)) throw error;
      throw new CfdiParserError(
        'PARSER_INTERNAL_ERROR',
        'The XML document could not be processed',
      );
    } finally {
      clearTimeout(timeout);
      parseOptions.signal?.removeEventListener('abort', stopForAbort);
    }
  }

  private createParser(
    accumulator: CfdiAccumulator,
    guard: ParserResourceGuard,
  ): SaxesParser<{ xmlns: true }> {
    const parser = new SaxesParser({
      xmlns: true,
      fragment: false,
      defaultXMLVersion: '1.0',
      position: false,
    });
    const stack: SaxesTagNS[] = [];
    const structure = new CfdiStructureGuard();

    parser.on('xmldecl', (declaration) => {
      guard.checkTime();
      if (declaration.version && declaration.version !== '1.0') {
        throw securityError();
      }
      const encoding = declaration.encoding?.toLowerCase();
      if (encoding && encoding !== 'utf-8' && encoding !== 'utf8') {
        throw securityError();
      }
    });
    parser.on('doctype', () => {
      throw securityError();
    });
    parser.on('processinginstruction', () => {
      throw securityError();
    });
    parser.on('error', () => {
      throw malformedError();
    });
    parser.on('opentag', (tag) => {
      guard.endTextNode();
      guard.openElement(tag);
      stack.push(tag);
      structure.open(tag);
      accumulator.open(tag, stack.length, stack);
    });
    parser.on('closetag', (tag) => {
      guard.endTextNode();
      accumulator.close(tag, stack.length);
      structure.close();
      stack.pop();
      guard.closeElement();
    });
    parser.on('text', (text) => guard.text(text));
    parser.on('cdata', (text) => guard.cdata(text));
    parser.on('comment', (text) => guard.comment(text));

    return parser;
  }
}

class ParserResourceGuard {
  private depth = 0;
  private nodes = 0;
  private attributes = 0;
  private currentTextBytes = 0;
  private inTextNode = false;

  constructor(
    private readonly options: SaxesCfdiParserOptions,
    private readonly startedAt: number,
    private readonly clock: () => number,
  ) {}

  checkTime(): void {
    if (this.clock() - this.startedAt > this.options.parseTimeoutMs) {
      throw limitError('time');
    }
  }

  openElement(tag: SaxesTagNS): void {
    this.checkTime();
    this.depth += 1;
    this.addNode();
    if (this.depth > this.options.maxDepth) throw limitError('depth');

    const attributes = Object.keys(tag.attributes).length;
    if (attributes > this.options.maxAttributesPerElement) {
      throw limitError('attributes_per_element');
    }
    this.attributes += attributes;
    if (this.attributes > this.options.maxAttributes) {
      throw limitError('attributes');
    }
  }

  closeElement(): void {
    this.depth -= 1;
    this.checkTime();
  }

  text(text: string): void {
    this.checkTime();
    if (!this.inTextNode) {
      this.inTextNode = true;
      this.currentTextBytes = 0;
      this.addNode();
    }
    this.currentTextBytes += Buffer.byteLength(text, 'utf8');
    if (this.currentTextBytes > this.options.maxTextNodeBytes) {
      throw limitError('text_node_bytes');
    }
  }

  cdata(text: string): void {
    this.endTextNode();
    this.addNode();
    if (Buffer.byteLength(text, 'utf8') > this.options.maxTextNodeBytes) {
      throw limitError('text_node_bytes');
    }
    this.checkTime();
  }

  comment(text: string): void {
    this.endTextNode();
    this.addNode();
    if (Buffer.byteLength(text, 'utf8') > this.options.maxTextNodeBytes) {
      throw limitError('text_node_bytes');
    }
    this.checkTime();
  }

  endTextNode(): void {
    this.inTextNode = false;
    this.currentTextBytes = 0;
  }

  private addNode(): void {
    this.nodes += 1;
    if (this.nodes > this.options.maxNodes) throw limitError('nodes');
  }
}

interface StructureChildRule {
  readonly uri: string;
  readonly local: string;
  readonly min: number;
  readonly max: number;
  readonly next: StructureRuleId;
}

type StructureRuleId =
  | 'opaque'
  | 'leaf'
  | 'cfdi-root'
  | 'cfdi-relations'
  | 'cfdi-concepts'
  | 'cfdi-concept'
  | 'cfdi-concept-taxes'
  | 'cfdi-root-taxes'
  | 'cfdi-transfers'
  | 'cfdi-withholdings'
  | 'cfdi-concept-complement'
  | 'cfdi-part'
  | 'cfdi-complement'
  | 'cfdi-addenda'
  | 'tfd'
  | 'payments'
  | 'payment'
  | 'payment-document'
  | 'payment-document-taxes'
  | 'payment-taxes'
  | 'payment-document-withholdings'
  | 'payment-document-transfers'
  | 'payment-withholdings'
  | 'payment-transfers'
  | 'payroll'
  | 'payroll-issuer'
  | 'payroll-receiver'
  | 'payroll-perceptions'
  | 'payroll-perception'
  | 'payroll-deductions'
  | 'payroll-other-payments'
  | 'payroll-other-payment'
  | 'payroll-incapacities';

interface StructureFrame {
  readonly ruleId: StructureRuleId;
  readonly counts: number[];
  lastIndex: number;
}

const MANY = Number.POSITIVE_INFINITY;

const STRUCTURE_RULES: Readonly<
  Record<Exclude<StructureRuleId, 'opaque'>, readonly StructureChildRule[]>
> = {
  leaf: [],
  'cfdi-root': [
    child(CFDI_40_NAMESPACE, 'InformacionGlobal', 0, 1, 'leaf'),
    child(CFDI_40_NAMESPACE, 'CfdiRelacionados', 0, MANY, 'cfdi-relations'),
    child(CFDI_40_NAMESPACE, 'Emisor', 1, 1, 'leaf'),
    child(CFDI_40_NAMESPACE, 'Receptor', 1, 1, 'leaf'),
    child(CFDI_40_NAMESPACE, 'Conceptos', 1, 1, 'cfdi-concepts'),
    child(CFDI_40_NAMESPACE, 'Impuestos', 0, 1, 'cfdi-root-taxes'),
    child(CFDI_40_NAMESPACE, 'Complemento', 0, 1, 'cfdi-complement'),
    child(CFDI_40_NAMESPACE, 'Addenda', 0, 1, 'cfdi-addenda'),
  ],
  'cfdi-relations': [
    child(CFDI_40_NAMESPACE, 'CfdiRelacionado', 1, MANY, 'leaf'),
  ],
  'cfdi-concepts': [
    child(CFDI_40_NAMESPACE, 'Concepto', 1, MANY, 'cfdi-concept'),
  ],
  'cfdi-concept': [
    child(CFDI_40_NAMESPACE, 'Impuestos', 0, 1, 'cfdi-concept-taxes'),
    child(CFDI_40_NAMESPACE, 'ACuentaTerceros', 0, 1, 'leaf'),
    child(CFDI_40_NAMESPACE, 'InformacionAduanera', 0, MANY, 'leaf'),
    child(CFDI_40_NAMESPACE, 'CuentaPredial', 0, MANY, 'leaf'),
    child(
      CFDI_40_NAMESPACE,
      'ComplementoConcepto',
      0,
      1,
      'cfdi-concept-complement',
    ),
    child(CFDI_40_NAMESPACE, 'Parte', 0, MANY, 'cfdi-part'),
  ],
  'cfdi-concept-taxes': [
    child(CFDI_40_NAMESPACE, 'Traslados', 0, 1, 'cfdi-transfers'),
    child(CFDI_40_NAMESPACE, 'Retenciones', 0, 1, 'cfdi-withholdings'),
  ],
  'cfdi-root-taxes': [
    child(CFDI_40_NAMESPACE, 'Retenciones', 0, 1, 'cfdi-withholdings'),
    child(CFDI_40_NAMESPACE, 'Traslados', 0, 1, 'cfdi-transfers'),
  ],
  'cfdi-transfers': [child(CFDI_40_NAMESPACE, 'Traslado', 1, MANY, 'leaf')],
  'cfdi-withholdings': [child(CFDI_40_NAMESPACE, 'Retencion', 1, MANY, 'leaf')],
  'cfdi-concept-complement': [child('*', '*', 1, MANY, 'opaque')],
  'cfdi-part': [
    child(CFDI_40_NAMESPACE, 'InformacionAduanera', 0, MANY, 'leaf'),
  ],
  'cfdi-complement': [child('*', '*', 0, MANY, 'opaque')],
  'cfdi-addenda': [child('*', '*', 1, MANY, 'opaque')],
  tfd: [],
  payments: [
    child(PAYMENTS_20_NAMESPACE, 'Totales', 1, 1, 'leaf'),
    child(PAYMENTS_20_NAMESPACE, 'Pago', 1, MANY, 'payment'),
  ],
  payment: [
    child(
      PAYMENTS_20_NAMESPACE,
      'DoctoRelacionado',
      1,
      MANY,
      'payment-document',
    ),
    child(PAYMENTS_20_NAMESPACE, 'ImpuestosP', 0, 1, 'payment-taxes'),
  ],
  'payment-document': [
    child(PAYMENTS_20_NAMESPACE, 'ImpuestosDR', 0, 1, 'payment-document-taxes'),
  ],
  'payment-document-taxes': [
    child(
      PAYMENTS_20_NAMESPACE,
      'RetencionesDR',
      0,
      1,
      'payment-document-withholdings',
    ),
    child(
      PAYMENTS_20_NAMESPACE,
      'TrasladosDR',
      0,
      1,
      'payment-document-transfers',
    ),
  ],
  'payment-taxes': [
    child(PAYMENTS_20_NAMESPACE, 'RetencionesP', 0, 1, 'payment-withholdings'),
    child(PAYMENTS_20_NAMESPACE, 'TrasladosP', 0, 1, 'payment-transfers'),
  ],
  'payment-document-withholdings': [
    child(PAYMENTS_20_NAMESPACE, 'RetencionDR', 1, MANY, 'leaf'),
  ],
  'payment-document-transfers': [
    child(PAYMENTS_20_NAMESPACE, 'TrasladoDR', 1, MANY, 'leaf'),
  ],
  'payment-withholdings': [
    child(PAYMENTS_20_NAMESPACE, 'RetencionP', 1, MANY, 'leaf'),
  ],
  'payment-transfers': [
    child(PAYMENTS_20_NAMESPACE, 'TrasladoP', 1, MANY, 'leaf'),
  ],
  payroll: [
    child(PAYROLL_12_NAMESPACE, 'Emisor', 0, 1, 'payroll-issuer'),
    child(PAYROLL_12_NAMESPACE, 'Receptor', 1, 1, 'payroll-receiver'),
    child(PAYROLL_12_NAMESPACE, 'Percepciones', 0, 1, 'payroll-perceptions'),
    child(PAYROLL_12_NAMESPACE, 'Deducciones', 0, 1, 'payroll-deductions'),
    child(PAYROLL_12_NAMESPACE, 'OtrosPagos', 0, 1, 'payroll-other-payments'),
    child(PAYROLL_12_NAMESPACE, 'Incapacidades', 0, 1, 'payroll-incapacities'),
  ],
  'payroll-issuer': [child(PAYROLL_12_NAMESPACE, 'EntidadSNCF', 0, 1, 'leaf')],
  'payroll-receiver': [
    child(PAYROLL_12_NAMESPACE, 'SubContratacion', 0, MANY, 'leaf'),
  ],
  'payroll-perceptions': [
    child(PAYROLL_12_NAMESPACE, 'Percepcion', 1, MANY, 'payroll-perception'),
    child(PAYROLL_12_NAMESPACE, 'JubilacionPensionRetiro', 0, 1, 'leaf'),
    child(PAYROLL_12_NAMESPACE, 'SeparacionIndemnizacion', 0, 1, 'leaf'),
  ],
  'payroll-perception': [
    child(PAYROLL_12_NAMESPACE, 'AccionesOTitulos', 0, 1, 'leaf'),
    child(PAYROLL_12_NAMESPACE, 'HorasExtra', 0, MANY, 'leaf'),
  ],
  'payroll-deductions': [
    child(PAYROLL_12_NAMESPACE, 'Deduccion', 1, MANY, 'leaf'),
  ],
  'payroll-other-payments': [
    child(PAYROLL_12_NAMESPACE, 'OtroPago', 1, MANY, 'payroll-other-payment'),
  ],
  'payroll-other-payment': [
    child(PAYROLL_12_NAMESPACE, 'SubsidioAlEmpleo', 0, 1, 'leaf'),
    child(PAYROLL_12_NAMESPACE, 'CompensacionSaldosAFavor', 0, 1, 'leaf'),
  ],
  'payroll-incapacities': [
    child(PAYROLL_12_NAMESPACE, 'Incapacidad', 1, MANY, 'leaf'),
  ],
};

/**
 * Small streaming schema-state machine for the supported CFDI subset. It
 * enforces the XSD element sequences and cardinalities without building a DOM
 * or resolving schemas at runtime.
 */
class CfdiStructureGuard {
  private readonly frames: StructureFrame[] = [];

  open(tag: SaxesTagNS): void {
    if (tag.uri === XINCLUDE_NAMESPACE) throw securityError();
    if (this.frames.length === 0) {
      this.frames.push(this.rootFrame(tag));
      return;
    }

    const parent = this.frames[this.frames.length - 1];
    if (parent.ruleId === 'opaque') {
      this.frames.push(this.frame('opaque'));
      return;
    }

    const rules = STRUCTURE_RULES[parent.ruleId];
    const index = rules.findIndex((rule) => matchesChild(rule, tag));
    if (index < 0 || index < parent.lastIndex) throw malformedError();

    const count = (parent.counts[index] ?? 0) + 1;
    if (count > rules[index].max) throw malformedError();
    parent.counts[index] = count;
    parent.lastIndex = index;

    this.frames.push(
      this.frame(this.resolveNext(parent.ruleId, tag, rules[index])),
    );
  }

  close(): void {
    const frame = this.frames.pop();
    if (!frame || frame.ruleId === 'opaque') return;
    const rules = STRUCTURE_RULES[frame.ruleId];
    if (rules.some((rule, index) => (frame.counts[index] ?? 0) < rule.min)) {
      throw malformedError();
    }
  }

  private rootFrame(tag: SaxesTagNS): StructureFrame {
    return this.frame(
      tag.uri === CFDI_40_NAMESPACE && tag.local === 'Comprobante'
        ? 'cfdi-root'
        : 'opaque',
    );
  }

  private frame(ruleId: StructureRuleId): StructureFrame {
    return { ruleId, counts: [], lastIndex: -1 };
  }

  private resolveNext(
    parentRuleId: StructureRuleId,
    tag: SaxesTagNS,
    matched: StructureChildRule,
  ): StructureRuleId {
    if (parentRuleId !== 'cfdi-complement') return matched.next;

    if (tag.uri === TFD_11_NAMESPACE) {
      if (tag.local !== 'TimbreFiscalDigital') throw malformedError();
      return 'tfd';
    }
    if (tag.uri === PAYMENTS_20_NAMESPACE) {
      if (tag.local !== 'Pagos') throw malformedError();
      return 'payments';
    }
    if (tag.uri === PAYROLL_12_NAMESPACE) {
      if (tag.local !== 'Nomina') throw malformedError();
      return 'payroll';
    }
    if (tag.uri === CFDI_40_NAMESPACE) throw malformedError();
    return 'opaque';
  }
}

function child(
  uri: string,
  local: string,
  min: number,
  max: number,
  next: StructureRuleId,
): StructureChildRule {
  return { uri, local, min, max, next };
}

function matchesChild(rule: StructureChildRule, tag: SaxesTagNS): boolean {
  return (
    (rule.uri === '*' || rule.uri === tag.uri) &&
    (rule.local === '*' || rule.local === tag.local)
  );
}

class CfdiAccumulator {
  private rootSeen = false;
  private unsupportedRoot = false;
  private readonly root: RootFields = {};
  private issuer?: ParsedCfdi['issuer'];
  private receiver?: ParsedCfdi['receiver'];
  private stamp?: CfdiStamp;
  private readonly concepts: CfdiConcept[] = [];
  private readonly taxes: CfdiTaxes = { lines: [] };
  private readonly relations: CfdiRelation[] = [];
  private readonly unsupportedComplements: UnsupportedCfdiComplement[] = [];
  private payments?: PaymentsBuilder;
  private payroll?: PayrollBuilder;
  private currentConcept?: CfdiConcept;
  private currentConceptDepth?: number;
  private currentRelationType?: string;
  private currentRelationDepth?: number;
  private relationGroupCount = 0;
  private currentRelationCount = 0;
  private currentPayment?: CfdiPayment;
  private currentPaymentDepth?: number;
  private currentPaymentDocument?: CfdiPaymentDocument;
  private currentPaymentDocumentDepth?: number;
  private currentOtherPayment?: CfdiPayrollOtherPayment;
  private currentOtherPaymentDepth?: number;
  private paymentsRootDepth?: number;
  private payrollRootDepth?: number;

  open(tag: SaxesTagNS, depth: number, stack: readonly SaxesTagNS[]): void {
    if (tag.uri === XINCLUDE_NAMESPACE) throw securityError();

    if (!this.rootSeen) {
      this.rootSeen = true;
      if (tag.local !== 'Comprobante') throw malformedError();
      if (tag.uri !== CFDI_40_NAMESPACE) {
        this.unsupportedRoot = true;
        return;
      }
      this.readRoot(tag);
      return;
    }

    if (this.unsupportedRoot) return;
    if (tag.uri === CFDI_40_NAMESPACE) {
      this.readCfdiElement(tag, depth, stack);
      return;
    }
    if (isDirectComplementChild(stack)) {
      this.readComplementRoot(tag, depth);
      return;
    }
    if (
      tag.uri === PAYMENTS_20_NAMESPACE &&
      this.paymentsRootDepth !== undefined &&
      depth > this.paymentsRootDepth
    ) {
      this.readPaymentElement(tag, depth, stack);
      return;
    }
    if (
      tag.uri === PAYROLL_12_NAMESPACE &&
      this.payrollRootDepth !== undefined &&
      depth > this.payrollRootDepth
    ) {
      this.readPayrollElement(tag, depth, stack);
    }
  }

  close(_tag: SaxesTagNS, depth: number): void {
    if (this.currentConceptDepth === depth) {
      this.currentConcept = undefined;
      this.currentConceptDepth = undefined;
    }
    if (this.currentRelationDepth === depth) {
      this.currentRelationType = undefined;
      this.currentRelationDepth = undefined;
    }
    if (this.currentPaymentDocumentDepth === depth) {
      this.currentPaymentDocument = undefined;
      this.currentPaymentDocumentDepth = undefined;
    }
    if (this.currentPaymentDepth === depth) {
      this.currentPayment = undefined;
      this.currentPaymentDepth = undefined;
    }
    if (this.currentOtherPaymentDepth === depth) {
      this.currentOtherPayment = undefined;
      this.currentOtherPaymentDepth = undefined;
    }
    if (this.paymentsRootDepth === depth) this.paymentsRootDepth = undefined;
    if (this.payrollRootDepth === depth) this.payrollRootDepth = undefined;
  }

  finish(): ParsedCfdi {
    if (!this.rootSeen) throw malformedError();
    if (this.unsupportedRoot || this.root.version !== '4.0') {
      throw new CfdiParserError(
        'CFDI_VERSION_UNSUPPORTED',
        'The CFDI version is not supported',
      );
    }
    if (!this.stamp) {
      throw new CfdiParserError(
        'CFDI_UUID_INVALID',
        'The CFDI does not contain a valid fiscal identifier',
      );
    }
    if (!this.issuer || !this.receiver || this.concepts.length === 0) {
      throw malformedError();
    }
    if (this.root.documentType === 'P' && !this.payments) {
      throw malformedError();
    }
    if (this.payments && this.root.documentType !== 'P') {
      throw malformedError();
    }
    if (this.root.documentType === 'N' && !this.payroll) {
      throw malformedError();
    }
    if (this.payroll && this.root.documentType !== 'N') {
      throw malformedError();
    }

    const document: ParsedCfdi = {
      version: this.root.version,
      issuedAt: requireValue(this.root.issuedAt),
      subtotal: requireValue(this.root.subtotal),
      currency: requireValue(this.root.currency),
      total: requireValue(this.root.total),
      documentType: requireValue(this.root.documentType),
      issueLocation: requireValue(this.root.issueLocation),
      stamp: this.stamp,
      issuer: this.issuer,
      receiver: this.receiver,
      concepts: this.concepts,
      taxes: this.taxes,
      relations: this.relations,
      unsupportedComplements: this.unsupportedComplements,
    };
    assignOptional(document, 'series', this.root.series);
    assignOptional(document, 'folio', this.root.folio);
    assignOptional(document, 'paymentForm', this.root.paymentForm);
    assignOptional(document, 'certificateNumber', this.root.certificateNumber);
    assignOptional(document, 'certificate', this.root.certificate);
    assignOptional(document, 'discount', this.root.discount);
    assignOptional(document, 'exchangeRate', this.root.exchangeRate);
    assignOptional(document, 'exportCode', this.root.exportCode);
    assignOptional(document, 'paymentMethod', this.root.paymentMethod);
    assignOptional(document, 'confirmation', this.root.confirmation);
    if (this.payments) {
      if (!this.payments.totals || this.payments.payments.length === 0) {
        throw malformedError();
      }
      document.payments = {
        version: '2.0',
        totals: this.payments.totals,
        payments: this.payments.payments,
      };
    }
    if (this.payroll) {
      if (!this.payroll.receiver) throw malformedError();
      document.payroll = {
        ...this.payroll,
        receiver: this.payroll.receiver,
      };
    }
    return document;
  }

  private readRoot(tag: SaxesTagNS): void {
    const version = requiredAttribute(tag, 'Version');
    if (version !== '4.0') {
      throw new CfdiParserError(
        'CFDI_VERSION_UNSUPPORTED',
        'The CFDI version is not supported',
      );
    }
    const documentType = requiredAttribute(tag, 'TipoDeComprobante');
    if (!ALLOWED_DOCUMENT_TYPES.has(documentType as CfdiDocumentType)) {
      throw malformedError();
    }
    this.root.version = '4.0';
    this.root.series = optionalAttribute(tag, 'Serie');
    this.root.folio = optionalAttribute(tag, 'Folio');
    this.root.issuedAt = requiredAttribute(tag, 'Fecha');
    this.root.paymentForm = optionalAttribute(tag, 'FormaPago');
    this.root.certificateNumber = optionalAttribute(tag, 'NoCertificado');
    this.root.certificate = optionalAttribute(tag, 'Certificado');
    this.root.subtotal = decimalAttribute(tag, 'SubTotal', true);
    this.root.discount = decimalAttribute(tag, 'Descuento');
    this.root.currency = requiredAttribute(tag, 'Moneda');
    this.root.exchangeRate = decimalAttribute(tag, 'TipoCambio');
    this.root.total = decimalAttribute(tag, 'Total', true);
    this.root.documentType = documentType as CfdiDocumentType;
    this.root.exportCode = optionalAttribute(tag, 'Exportacion');
    this.root.paymentMethod = optionalAttribute(tag, 'MetodoPago');
    this.root.issueLocation = requiredAttribute(tag, 'LugarExpedicion');
    this.root.confirmation = optionalAttribute(tag, 'Confirmacion');
  }

  private readCfdiElement(
    tag: SaxesTagNS,
    depth: number,
    stack: readonly SaxesTagNS[],
  ): void {
    switch (tag.local) {
      case 'Emisor':
        requireCfdiPath(stack, ['Comprobante', 'Emisor']);
        this.issuer = {
          rfc: normalizedRfc(requiredAttribute(tag, 'Rfc')),
          name: requiredAttribute(tag, 'Nombre'),
          fiscalRegime: requiredAttribute(tag, 'RegimenFiscal'),
        };
        break;
      case 'Receptor':
        requireCfdiPath(stack, ['Comprobante', 'Receptor']);
        this.receiver = {
          rfc: normalizedRfc(requiredAttribute(tag, 'Rfc')),
          name: requiredAttribute(tag, 'Nombre'),
          fiscalAddress: requiredAttribute(tag, 'DomicilioFiscalReceptor'),
          fiscalRegime: requiredAttribute(tag, 'RegimenFiscalReceptor'),
          cfdiUse: requiredAttribute(tag, 'UsoCFDI'),
        };
        assignOptional(
          this.receiver,
          'taxResidence',
          optionalAttribute(tag, 'ResidenciaFiscal'),
        );
        assignOptional(
          this.receiver,
          'foreignTaxRegistration',
          optionalAttribute(tag, 'NumRegIdTrib'),
        );
        break;
      case 'CfdiRelacionados':
        requireCfdiPath(stack, ['Comprobante', 'CfdiRelacionados']);
        this.relationGroupCount += 1;
        this.currentRelationCount = 0;
        this.currentRelationType = requiredAttribute(tag, 'TipoRelacion');
        this.currentRelationDepth = depth;
        break;
      case 'CfdiRelacionado':
        requireCfdiPath(stack, [
          'Comprobante',
          'CfdiRelacionados',
          'CfdiRelacionado',
        ]);
        if (!this.currentRelationType) throw malformedError();
        this.currentRelationCount += 1;
        this.relations.push({
          relationGroupOrdinal: this.relationGroupCount,
          relationOrdinal: this.currentRelationCount,
          relationType: this.currentRelationType,
          relatedUuid: normalizedUuid(
            requiredAttribute(tag, 'UUID'),
            'XML_MALFORMED',
          ),
        });
        break;
      case 'Concepto': {
        requireCfdiPath(stack, ['Comprobante', 'Conceptos', 'Concepto']);
        const concept: CfdiConcept = {
          productServiceCode: requiredAttribute(tag, 'ClaveProdServ'),
          quantity: decimalAttribute(tag, 'Cantidad', true),
          description: requiredAttribute(tag, 'Descripcion'),
          unitValue: decimalAttribute(tag, 'ValorUnitario', true),
          amount: decimalAttribute(tag, 'Importe', true),
          taxes: { lines: [] },
        };
        assignOptional(
          concept,
          'identificationNumber',
          optionalAttribute(tag, 'NoIdentificacion'),
        );
        assignOptional(
          concept,
          'unitCode',
          optionalAttribute(tag, 'ClaveUnidad'),
        );
        assignOptional(concept, 'unit', optionalAttribute(tag, 'Unidad'));
        assignOptional(concept, 'discount', decimalAttribute(tag, 'Descuento'));
        assignOptional(
          concept,
          'taxObject',
          optionalAttribute(tag, 'ObjetoImp'),
        );
        this.concepts.push(concept);
        this.currentConcept = concept;
        this.currentConceptDepth = depth;
        break;
      }
      case 'Impuestos': {
        if (
          !isCfdiPath(stack, ['Comprobante', 'Impuestos']) &&
          !isCfdiPath(stack, [
            'Comprobante',
            'Conceptos',
            'Concepto',
            'Impuestos',
          ])
        ) {
          throw malformedError();
        }
        const target = this.currentConcept?.taxes ?? this.taxes;
        assignOptional(
          target,
          'totalTransferred',
          decimalAttribute(tag, 'TotalImpuestosTrasladados'),
        );
        assignOptional(
          target,
          'totalWithheld',
          decimalAttribute(tag, 'TotalImpuestosRetenidos'),
        );
        break;
      }
      case 'Traslado':
      case 'Retencion': {
        const wrapper = tag.local === 'Traslado' ? 'Traslados' : 'Retenciones';
        if (
          !isCfdiPath(stack, [
            'Comprobante',
            'Impuestos',
            wrapper,
            tag.local,
          ]) &&
          !isCfdiPath(stack, [
            'Comprobante',
            'Conceptos',
            'Concepto',
            'Impuestos',
            wrapper,
            tag.local,
          ])
        ) {
          throw malformedError();
        }
        const target = this.currentConcept?.taxes ?? this.taxes;
        const line: CfdiTaxes['lines'][number] = {
          kind: tag.local === 'Traslado' ? 'transfer' : 'withholding',
          tax: requiredAttribute(tag, 'Impuesto'),
        };
        assignOptional(line, 'base', decimalAttribute(tag, 'Base'));
        assignOptional(
          line,
          'factorType',
          optionalAttribute(tag, 'TipoFactor'),
        );
        assignOptional(
          line,
          'rateOrQuota',
          decimalAttribute(tag, 'TasaOCuota'),
        );
        assignOptional(line, 'amount', decimalAttribute(tag, 'Importe'));
        target.lines.push(line);
        break;
      }
      default:
        if (isDirectComplementChild(stack)) {
          this.addUnsupportedComplement(tag);
        }
    }
  }

  private readComplementRoot(tag: SaxesTagNS, depth: number): void {
    if (tag.uri === TFD_11_NAMESPACE && tag.local === 'TimbreFiscalDigital') {
      if (this.stamp) throw malformedError();
      const version = requiredAttribute(tag, 'Version');
      if (version !== '1.1') throw unsupportedComplementError();
      this.stamp = {
        version: '1.1',
        uuid: normalizedUuid(
          requiredAttribute(tag, 'UUID'),
          'CFDI_UUID_INVALID',
        ),
        stampedAt: requiredAttribute(tag, 'FechaTimbrado'),
        certifyingProviderRfc: normalizedRfc(
          requiredAttribute(tag, 'RfcProvCertif'),
        ),
        satCertificateNumber: requiredAttribute(tag, 'NoCertificadoSAT'),
        cfdiSeal: requiredAttribute(tag, 'SelloCFD'),
        satSeal: requiredAttribute(tag, 'SelloSAT'),
      };
      return;
    }
    if (tag.uri === PAYMENTS_20_NAMESPACE && tag.local === 'Pagos') {
      if (this.payments) throw malformedError();
      if (requiredAttribute(tag, 'Version') !== '2.0') {
        throw unsupportedComplementError();
      }
      this.payments = { version: '2.0', payments: [] };
      this.paymentsRootDepth = depth;
      return;
    }
    if (tag.uri === PAYROLL_12_NAMESPACE && tag.local === 'Nomina') {
      if (this.payroll) throw malformedError();
      if (requiredAttribute(tag, 'Version') !== '1.2') {
        throw unsupportedComplementError();
      }
      this.payroll = {
        version: '1.2',
        payrollType: requiredAttribute(tag, 'TipoNomina'),
        paymentDate: requiredAttribute(tag, 'FechaPago'),
        initialPaymentDate: requiredAttribute(tag, 'FechaInicialPago'),
        finalPaymentDate: requiredAttribute(tag, 'FechaFinalPago'),
        paidDays: decimalAttribute(tag, 'NumDiasPagados', true),
        totalPerceptions: decimalAttribute(tag, 'TotalPercepciones'),
        totalDeductions: decimalAttribute(tag, 'TotalDeducciones'),
        totalOtherPayments: decimalAttribute(tag, 'TotalOtrosPagos'),
        perceptions: [],
        deductions: [],
        otherPayments: [],
        incapacities: [],
      };
      this.payrollRootDepth = depth;
      return;
    }
    this.addUnsupportedComplement(tag);
  }

  private readPaymentElement(
    tag: SaxesTagNS,
    depth: number,
    stack: readonly SaxesTagNS[],
  ): void {
    if (!this.payments) return;
    switch (tag.local) {
      case 'Totales':
        requirePaymentPath(stack, ['Pagos', 'Totales']);
        this.payments.totals = {
          totalPayments: decimalAttribute(tag, 'MontoTotalPagos', true),
          totalWithheldVat: decimalAttribute(tag, 'TotalRetencionesIVA'),
          totalWithheldIncomeTax: decimalAttribute(tag, 'TotalRetencionesISR'),
          totalWithheldExciseTax: decimalAttribute(tag, 'TotalRetencionesIEPS'),
          totalTransferredVatBase16: decimalAttribute(
            tag,
            'TotalTrasladosBaseIVA16',
          ),
          totalTransferredVatTax16: decimalAttribute(
            tag,
            'TotalTrasladosImpuestoIVA16',
          ),
          totalTransferredVatBase8: decimalAttribute(
            tag,
            'TotalTrasladosBaseIVA8',
          ),
          totalTransferredVatTax8: decimalAttribute(
            tag,
            'TotalTrasladosImpuestoIVA8',
          ),
          totalTransferredVatBase0: decimalAttribute(
            tag,
            'TotalTrasladosBaseIVA0',
          ),
          totalTransferredVatTax0: decimalAttribute(
            tag,
            'TotalTrasladosImpuestoIVA0',
          ),
          totalTransferredVatBaseExempt: decimalAttribute(
            tag,
            'TotalTrasladosBaseIVAExento',
          ),
        };
        break;
      case 'Pago': {
        requirePaymentPath(stack, ['Pagos', 'Pago']);
        const payment: CfdiPayment = {
          paidAt: requiredAttribute(tag, 'FechaPago'),
          paymentForm: requiredAttribute(tag, 'FormaDePagoP'),
          currency: requiredAttribute(tag, 'MonedaP'),
          amount: decimalAttribute(tag, 'Monto', true),
          relatedDocuments: [],
          taxes: { lines: [] },
        };
        assignOptional(
          payment,
          'exchangeRate',
          decimalAttribute(tag, 'TipoCambioP'),
        );
        assignOptional(
          payment,
          'operationNumber',
          optionalAttribute(tag, 'NumOperacion'),
        );
        assignOptional(
          payment,
          'payerRfc',
          optionalAttribute(tag, 'RfcEmisorCtaOrd'),
        );
        assignOptional(
          payment,
          'payerForeignBankName',
          optionalAttribute(tag, 'NomBancoOrdExt'),
        );
        assignOptional(
          payment,
          'payerAccount',
          optionalAttribute(tag, 'CtaOrdenante'),
        );
        assignOptional(
          payment,
          'beneficiaryRfc',
          optionalAttribute(tag, 'RfcEmisorCtaBen'),
        );
        assignOptional(
          payment,
          'beneficiaryAccount',
          optionalAttribute(tag, 'CtaBeneficiario'),
        );
        assignOptional(
          payment,
          'paymentChainType',
          optionalAttribute(tag, 'TipoCadPago'),
        );
        assignOptional(
          payment,
          'certificate',
          optionalAttribute(tag, 'CertPago'),
        );
        assignOptional(
          payment,
          'paymentChain',
          optionalAttribute(tag, 'CadPago'),
        );
        assignOptional(
          payment,
          'signature',
          optionalAttribute(tag, 'SelloPago'),
        );
        this.payments.payments.push(payment);
        this.currentPayment = payment;
        this.currentPaymentDepth = depth;
        break;
      }
      case 'DoctoRelacionado': {
        requirePaymentPath(stack, ['Pagos', 'Pago', 'DoctoRelacionado']);
        if (!this.currentPayment) throw malformedError();
        const document: CfdiPaymentDocument = {
          uuid: normalizedUuid(
            requiredAttribute(tag, 'IdDocumento'),
            'XML_MALFORMED',
          ),
          currency: requiredAttribute(tag, 'MonedaDR'),
          partialityNumber: requiredAttribute(tag, 'NumParcialidad'),
          previousBalance: decimalAttribute(tag, 'ImpSaldoAnt', true),
          paidAmount: decimalAttribute(tag, 'ImpPagado', true),
          unpaidBalance: decimalAttribute(tag, 'ImpSaldoInsoluto', true),
          taxes: { lines: [] },
        };
        assignOptional(document, 'series', optionalAttribute(tag, 'Serie'));
        assignOptional(document, 'folio', optionalAttribute(tag, 'Folio'));
        assignOptional(
          document,
          'equivalence',
          decimalAttribute(tag, 'EquivalenciaDR'),
        );
        assignOptional(
          document,
          'taxObject',
          optionalAttribute(tag, 'ObjetoImpDR'),
        );
        this.currentPayment.relatedDocuments.push(document);
        this.currentPaymentDocument = document;
        this.currentPaymentDocumentDepth = depth;
        break;
      }
      case 'TrasladoDR':
      case 'RetencionDR': {
        const wrapper =
          tag.local === 'TrasladoDR' ? 'TrasladosDR' : 'RetencionesDR';
        requirePaymentPath(stack, [
          'Pagos',
          'Pago',
          'DoctoRelacionado',
          'ImpuestosDR',
          wrapper,
          tag.local,
        ]);
        if (!this.currentPaymentDocument) throw malformedError();
        const suffix = tag.local === 'TrasladoDR' ? 'DR' : 'DR';
        const line: CfdiTaxes['lines'][number] = {
          kind: tag.local === 'TrasladoDR' ? 'transfer' : 'withholding',
          tax: requiredAttribute(tag, `Impuesto${suffix}`),
        };
        assignOptional(line, 'base', decimalAttribute(tag, `Base${suffix}`));
        assignOptional(
          line,
          'factorType',
          optionalAttribute(tag, `TipoFactor${suffix}`),
        );
        assignOptional(
          line,
          'rateOrQuota',
          decimalAttribute(tag, `TasaOCuota${suffix}`),
        );
        assignOptional(
          line,
          'amount',
          decimalAttribute(tag, `Importe${suffix}`),
        );
        this.currentPaymentDocument.taxes.lines.push(line);
        break;
      }
      case 'TrasladoP':
      case 'RetencionP': {
        const wrapper =
          tag.local === 'TrasladoP' ? 'TrasladosP' : 'RetencionesP';
        requirePaymentPath(stack, [
          'Pagos',
          'Pago',
          'ImpuestosP',
          wrapper,
          tag.local,
        ]);
        if (!this.currentPayment) throw malformedError();
        const line: CfdiTaxes['lines'][number] = {
          kind: tag.local === 'TrasladoP' ? 'transfer' : 'withholding',
          tax: requiredAttribute(tag, 'ImpuestoP'),
        };
        assignOptional(line, 'base', decimalAttribute(tag, 'BaseP'));
        assignOptional(
          line,
          'factorType',
          optionalAttribute(tag, 'TipoFactorP'),
        );
        assignOptional(
          line,
          'rateOrQuota',
          decimalAttribute(tag, 'TasaOCuotaP'),
        );
        assignOptional(line, 'amount', decimalAttribute(tag, 'ImporteP'));
        this.currentPayment.taxes.lines.push(line);
        break;
      }
    }
  }

  private readPayrollElement(
    tag: SaxesTagNS,
    depth: number,
    stack: readonly SaxesTagNS[],
  ): void {
    if (!this.payroll) return;
    switch (tag.local) {
      case 'Emisor':
        requirePayrollPath(stack, ['Nomina', 'Emisor']);
        this.payroll.issuer = {
          curp: optionalAttribute(tag, 'Curp'),
          employerRegistration: optionalAttribute(tag, 'RegistroPatronal'),
          sourceEmployerRfc: optionalAttribute(tag, 'RfcPatronOrigen'),
        };
        break;
      case 'Receptor':
        requirePayrollPath(stack, ['Nomina', 'Receptor']);
        this.payroll.receiver = {
          curp: requiredAttribute(tag, 'Curp'),
          socialSecurityNumber: optionalAttribute(tag, 'NumSeguridadSocial'),
          employmentStartDate: optionalAttribute(tag, 'FechaInicioRelLaboral'),
          seniority: optionalAttribute(tag, 'Antigüedad'),
          contractType: requiredAttribute(tag, 'TipoContrato'),
          unionized: optionalAttribute(tag, 'Sindicalizado'),
          workdayType: optionalAttribute(tag, 'TipoJornada'),
          regimeType: requiredAttribute(tag, 'TipoRegimen'),
          employeeNumber: requiredAttribute(tag, 'NumEmpleado'),
          department: optionalAttribute(tag, 'Departamento'),
          position: optionalAttribute(tag, 'Puesto'),
          occupationalRisk: optionalAttribute(tag, 'RiesgoPuesto'),
          paymentFrequency: requiredAttribute(tag, 'PeriodicidadPago'),
          bank: optionalAttribute(tag, 'Banco'),
          bankAccount: optionalAttribute(tag, 'CuentaBancaria'),
          contributionBaseSalary: decimalAttribute(tag, 'SalarioBaseCotApor'),
          integratedDailySalary: decimalAttribute(
            tag,
            'SalarioDiarioIntegrado',
          ),
          federalEntityCode: requiredAttribute(tag, 'ClaveEntFed'),
        };
        break;
      case 'Percepcion':
        requirePayrollPath(stack, ['Nomina', 'Percepciones', 'Percepcion']);
        this.payroll.perceptions.push({
          perceptionType: requiredAttribute(tag, 'TipoPercepcion'),
          code: requiredAttribute(tag, 'Clave'),
          description: requiredAttribute(tag, 'Concepto'),
          taxableAmount: decimalAttribute(tag, 'ImporteGravado', true),
          exemptAmount: decimalAttribute(tag, 'ImporteExento', true),
        });
        break;
      case 'Deduccion':
        requirePayrollPath(stack, ['Nomina', 'Deducciones', 'Deduccion']);
        this.payroll.deductions.push({
          deductionType: requiredAttribute(tag, 'TipoDeduccion'),
          code: requiredAttribute(tag, 'Clave'),
          description: requiredAttribute(tag, 'Concepto'),
          amount: decimalAttribute(tag, 'Importe', true),
        });
        break;
      case 'OtroPago': {
        requirePayrollPath(stack, ['Nomina', 'OtrosPagos', 'OtroPago']);
        const otherPayment: CfdiPayrollOtherPayment = {
          otherPaymentType: requiredAttribute(tag, 'TipoOtroPago'),
          code: requiredAttribute(tag, 'Clave'),
          description: requiredAttribute(tag, 'Concepto'),
          amount: decimalAttribute(tag, 'Importe', true),
        };
        this.payroll.otherPayments.push(otherPayment);
        this.currentOtherPayment = otherPayment;
        this.currentOtherPaymentDepth = depth;
        break;
      }
      case 'SubsidioAlEmpleo':
        requirePayrollPath(stack, [
          'Nomina',
          'OtrosPagos',
          'OtroPago',
          'SubsidioAlEmpleo',
        ]);
        if (!this.currentOtherPayment) throw malformedError();
        this.currentOtherPayment.employmentSubsidy = decimalAttribute(
          tag,
          'SubsidioCausado',
          true,
        );
        break;
      case 'CompensacionSaldosAFavor':
        requirePayrollPath(stack, [
          'Nomina',
          'OtrosPagos',
          'OtroPago',
          'CompensacionSaldosAFavor',
        ]);
        if (!this.currentOtherPayment) throw malformedError();
        this.currentOtherPayment.positiveBalance = decimalAttribute(
          tag,
          'SaldoAFavor',
          true,
        );
        this.currentOtherPayment.positiveBalanceYear = requiredAttribute(
          tag,
          'Año',
        );
        this.currentOtherPayment.remainingPositiveBalance = decimalAttribute(
          tag,
          'RemanenteSalFav',
          true,
        );
        break;
      case 'Incapacidad':
        requirePayrollPath(stack, ['Nomina', 'Incapacidades', 'Incapacidad']);
        this.payroll.incapacities.push({
          days: decimalAttribute(tag, 'DiasIncapacidad', true),
          incapacityType: requiredAttribute(tag, 'TipoIncapacidad'),
          amount: decimalAttribute(tag, 'ImporteMonetario'),
        });
        break;
    }
  }

  private addUnsupportedComplement(tag: SaxesTagNS): void {
    const candidate = { namespaceUri: tag.uri, localName: tag.local };
    if (
      !this.unsupportedComplements.some(
        (entry) =>
          entry.namespaceUri === candidate.namespaceUri &&
          entry.localName === candidate.localName,
      )
    ) {
      this.unsupportedComplements.push(candidate);
    }
  }
}

function validateOptions(
  input: SaxesCfdiParserOptions,
): SaxesCfdiParserOptions {
  const ceilings: Array<[keyof SaxesCfdiParserOptions, number]> = [
    ['maxBytes', ABSOLUTE_XML_MAX_BYTES],
    ['maxDepth', 64],
    ['maxNodes', 200_000],
    ['maxAttributes', 100_000],
    ['maxAttributesPerElement', 128],
    ['maxTextNodeBytes', 1024 * 1024],
    ['parseTimeoutMs', 5_000],
  ];
  for (const [key, ceiling] of ceilings) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new Error(`Invalid CFDI parser option: ${String(key)}`);
    }
    if (value > ceiling) {
      throw new Error(`Unsafe CFDI parser option: ${String(key)}`);
    }
  }
  if (input.maxAttributesPerElement > input.maxAttributes) {
    throw new Error('Invalid CFDI parser attribute limits');
  }
  return { ...input };
}

function isDirectComplementChild(stack: readonly SaxesTagNS[]): boolean {
  return (
    stack.length === 3 &&
    stack[0]?.uri === CFDI_40_NAMESPACE &&
    stack[0]?.local === 'Comprobante' &&
    stack[1]?.uri === CFDI_40_NAMESPACE &&
    stack[1]?.local === 'Complemento'
  );
}

function isCfdiPath(
  stack: readonly SaxesTagNS[],
  localNames: readonly string[],
): boolean {
  return (
    stack.length === localNames.length &&
    stack.every(
      (tag, index) =>
        tag.uri === CFDI_40_NAMESPACE && tag.local === localNames[index],
    )
  );
}

function requireCfdiPath(
  stack: readonly SaxesTagNS[],
  localNames: readonly string[],
): void {
  if (!isCfdiPath(stack, localNames)) throw malformedError();
}

function isComplementPath(
  stack: readonly SaxesTagNS[],
  namespaceUri: string,
  localNames: readonly string[],
): boolean {
  if (stack.length !== localNames.length + 2) return false;
  if (
    stack[0]?.uri !== CFDI_40_NAMESPACE ||
    stack[0]?.local !== 'Comprobante' ||
    stack[1]?.uri !== CFDI_40_NAMESPACE ||
    stack[1]?.local !== 'Complemento'
  ) {
    return false;
  }
  return localNames.every((localName, index) => {
    const tag = stack[index + 2];
    return tag?.uri === namespaceUri && tag.local === localName;
  });
}

function requirePaymentPath(
  stack: readonly SaxesTagNS[],
  localNames: readonly string[],
): void {
  if (!isComplementPath(stack, PAYMENTS_20_NAMESPACE, localNames)) {
    throw malformedError();
  }
}

function requirePayrollPath(
  stack: readonly SaxesTagNS[],
  localNames: readonly string[],
): void {
  if (!isComplementPath(stack, PAYROLL_12_NAMESPACE, localNames)) {
    throw malformedError();
  }
}

function attributes(tag: SaxesTagNS): SaxesAttributeNS[] {
  return Object.values(tag.attributes);
}

function optionalAttribute(
  tag: SaxesTagNS,
  localName: string,
): string | undefined {
  const value = attributes(tag).find(
    (candidate) => candidate.uri === '' && candidate.local === localName,
  )?.value;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requiredAttribute(tag: SaxesTagNS, localName: string): string {
  const value = optionalAttribute(tag, localName);
  if (!value) throw malformedError();
  return value;
}

function decimalAttribute(
  tag: SaxesTagNS,
  localName: string,
  required: true,
): string;
function decimalAttribute(
  tag: SaxesTagNS,
  localName: string,
  required?: false,
): string | undefined;
function decimalAttribute(
  tag: SaxesTagNS,
  localName: string,
  required = false,
): string | undefined {
  const value = optionalAttribute(tag, localName);
  if (!value) {
    if (required) throw malformedError();
    return undefined;
  }
  if (!DECIMAL_PATTERN.test(value)) throw malformedError();
  return value;
}

function normalizedUuid(
  value: string,
  errorCode: 'CFDI_UUID_INVALID' | 'XML_MALFORMED',
): string {
  if (!UUID_PATTERN.test(value)) {
    throw new CfdiParserError(
      errorCode,
      errorCode === 'CFDI_UUID_INVALID'
        ? 'The CFDI does not contain a valid fiscal identifier'
        : 'The XML document is not a valid supported CFDI',
    );
  }
  return value.toLowerCase();
}

function normalizedRfc(value: string): string {
  return value.trim().toUpperCase();
}

function assignOptional<TObject extends object, TKey extends keyof TObject>(
  object: TObject,
  key: TKey,
  value: TObject[TKey] | undefined,
): void {
  if (value !== undefined) object[key] = value;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw malformedError();
  return value;
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  throw new CfdiParserError(
    'PARSER_INTERNAL_ERROR',
    'The XML input stream returned an unsupported chunk',
  );
}

function assertUtf8Encoding(prefix: Buffer): void {
  const utf16Bom =
    (prefix[0] === 0xff && prefix[1] === 0xfe) ||
    (prefix[0] === 0xfe && prefix[1] === 0xff);
  const utf16WithoutBom =
    (prefix[0] === 0x00 && prefix[1] === 0x3c) ||
    (prefix[0] === 0x3c && prefix[1] === 0x00);
  if (utf16Bom || utf16WithoutBom) throw securityError();
}

function decodeUtf8(
  decoder: TextDecoder,
  bytes: Buffer | undefined,
  stream: boolean,
): string {
  try {
    return decoder.decode(bytes, { stream });
  } catch {
    throw securityError();
  }
}

function fileTooLargeError(): CfdiParserError {
  return new CfdiParserError(
    'INGESTION_FILE_TOO_LARGE',
    'The XML document exceeds the allowed size',
    'bytes',
  );
}

function malformedError(): CfdiParserError {
  return new CfdiParserError(
    'XML_MALFORMED',
    'The XML document is not a valid supported CFDI',
  );
}

function securityError(): CfdiParserError {
  return new CfdiParserError(
    'XML_SECURITY_VIOLATION',
    'The XML document was rejected by the security policy',
  );
}

function limitError(limit: CfdiParserLimit): CfdiParserError {
  return new CfdiParserError(
    'XML_SECURITY_VIOLATION',
    'The XML document exceeded a parser security limit',
    limit,
  );
}

function unsupportedComplementError(): CfdiParserError {
  return new CfdiParserError(
    'COMPLEMENT_UNSUPPORTED',
    'The CFDI complement version is not supported',
  );
}

function abortedError(): CfdiParserError {
  return new CfdiParserError(
    'PARSER_ABORTED',
    'The XML parsing operation was aborted',
  );
}
