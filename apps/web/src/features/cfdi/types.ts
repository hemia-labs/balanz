import type { CollectionPage, PageMeta } from "../clients/types";

export type CfdiType = "I" | "E" | "T" | "N" | "P";

export interface CfdiListItem {
  id: string;
  clientAccountId: string | null;
  legalEntityId: string | null;
  uuid: string;
  version: string;
  schemaVersion: string;
  parserVersion: string;
  type: CfdiType;
  issuedAt: string;
  certifiedAt: string;
  issuerRfc: string;
  issuerName: string | null;
  receiverRfc: string;
  receiverName: string | null;
  receiverFiscalZip: string | null;
  receiverFiscalRegimeCode: string | null;
  usageCode: string | null;
  total: string;
  subtotal: string;
  discount: string | null;
  currency: string;
  exchangeRate: string | null;
  paymentForm: string | null;
  paymentMethod: string | null;
  placeOfIssue: string | null;
  exportCode: string | null;
  createdAt: string;
  updatedAt: string;
  recordVersion: number;
}

export interface CfdiConcept {
  id: string;
  productServiceCode: string;
  identificationNumber: string | null;
  quantity: string;
  unitCode: string;
  unit: string | null;
  description: string;
  unitValue: string;
  amount: string;
  discount: string | null;
}

export interface CfdiTax {
  id: string;
  conceptId: string | null;
  scope: "document" | "concept" | "payment" | "payment_document";
  kind: "transfer" | "withholding";
  taxCode: string;
  factorType: string | null;
  base: string | null;
  rateOrQuota: string | null;
  amount: string | null;
}

export interface CfdiRelation {
  id: string;
  relationType: string;
  relatedUuid: string;
}

export interface CfdiPaymentDocument {
  id: string;
  paymentId: string | null;
  relatedUuid: string;
  currency: string;
  partialityNumber: number | null;
  previousBalance: string | null;
  paidAmount: string | null;
  outstandingBalance: string | null;
  taxObject: string | null;
}

export interface CfdiPayment {
  id: string;
  paidAt: string;
  paymentForm: string;
  currency: string;
  exchangeRate: string | null;
  amount: string;
  operationNumber: string | null;
  payerBankRfc: string | null;
  payerForeignBankName: string | null;
  payerAccount: string | null;
  beneficiaryBankRfc: string | null;
  beneficiaryAccount: string | null;
  documents: CfdiPaymentDocument[];
}

export interface CfdiPayrollPerception {
  ordinal: number;
  type: string;
  key: string;
  concept: string;
  taxableAmount: string;
  exemptAmount: string;
}

export interface CfdiPayrollDeduction {
  ordinal: number;
  type: string;
  key: string;
  concept: string;
  amount: string;
}

export interface CfdiPayrollOtherPayment {
  ordinal: number;
  type: string;
  key: string;
  concept: string;
  amount: string;
}

export interface CfdiPayrollIncapacity {
  ordinal: number;
  days: string;
  type: string;
  amount: string | null;
}

export interface CfdiPayroll {
  payrollVersion: string;
  payrollType: string;
  paymentDate: string;
  initialPaymentDate: string;
  finalPaymentDate: string;
  daysPaid: string;
  employeeCurp: string | null;
  employeeNumber: string | null;
  employerRegistration: string | null;
  employeeSocialSecurityNumber: string | null;
  regimeType: string | null;
  contractType: string | null;
  position: string | null;
  paymentPeriodicity: string | null;
  baseSalary: string | null;
  integratedDailySalary: string | null;
  totalPerceptions: string | null;
  totalDeductions: string | null;
  totalOtherPayments: string | null;
  perceptions: CfdiPayrollPerception[];
  deductions: CfdiPayrollDeduction[];
  otherPayments: CfdiPayrollOtherPayment[];
  incapacities: CfdiPayrollIncapacity[];
}

export interface CfdiPeriodParticipation {
  id: string;
  year: number;
  month: number;
  participationType: string;
  policyVersion: string;
  timezone: string;
  sourceDate: string;
  origin: "automatic" | "manual" | string;
}

export interface CfdiIncident {
  id: string;
  code: string;
  severity: string;
  status: string;
  safeDetail: string | null;
  createdAt: string | null;
}

export interface CfdiProvenance {
  id: string;
  objectId: string | null;
  jobId: string | null;
  observedAt: string | null;
  parserVersion: string | null;
  schemaVersion: string | null;
  parsedCfdiVersion: string | null;
  result: string | null;
  processedAt: string | null;
}

export interface CfdiDetail extends CfdiListItem {
  concepts: CfdiConcept[];
  taxes: CfdiTax[];
  relations: CfdiRelation[];
  payments: CfdiPayment[];
  payroll: CfdiPayroll | null;
  provenance: CfdiProvenance[];
  periods: CfdiPeriodParticipation[];
  incidents: CfdiIncident[];
}

export type CfdiPage = CollectionPage<CfdiListItem>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unwrap(value: unknown) {
  const root = record(value);
  return root.data && typeof root.data === "object" ? record(root.data) : root;
}

function text(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function optionalText(value: unknown) {
  const result = text(value);
  return result ? result : null;
}

function integer(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : fallback;
}

function entries(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function meta(value: unknown, count: number): PageMeta {
  const source = record(value);
  const page = Math.max(1, integer(source.page, 1));
  const limit = Math.max(1, Math.min(100, integer(source.limit, 20)));
  const total = integer(source.total, count);
  return {
    page,
    limit,
    total,
    totalPages: Math.max(
      total ? 1 : 0,
      integer(
        source.totalPages ?? source.total_pages,
        Math.ceil(total / limit),
      ),
    ),
  };
}

function normalizeType(value: unknown): CfdiType {
  const candidate = text(value, "I").toUpperCase();
  return (["I", "E", "T", "N", "P"] as const).includes(candidate as CfdiType)
    ? (candidate as CfdiType)
    : "I";
}

export function normalizeCfdiListItem(value: unknown): CfdiListItem {
  const source = record(value);
  const issuer = record(source.issuer);
  const receiver = record(source.receiver);
  return {
    id: text(source.id ?? source.cfdiId ?? source.cfdi_id),
    clientAccountId: optionalText(
      source.clientAccountId ?? source.client_account_id,
    ),
    legalEntityId: optionalText(source.legalEntityId ?? source.legal_entity_id),
    uuid: text(source.uuid ?? source.normalizedUuid ?? source.normalized_uuid),
    version: text(source.version ?? source.cfdiVersion ?? source.cfdi_version),
    schemaVersion: text(source.schemaVersion ?? source.schema_version),
    parserVersion: text(source.parserVersion ?? source.parser_version),
    type: normalizeType(
      source.documentType ??
        source.type ??
        source.cfdiType ??
        source.tipoDeComprobante,
    ),
    issuedAt: text(source.issuedAt ?? source.issued_at ?? source.fecha),
    certifiedAt: text(source.certifiedAt ?? source.certified_at),
    issuerRfc: text(
      issuer.rfc ?? source.issuerRfc ?? source.issuer_rfc ?? source.emisorRfc,
    ),
    issuerName: optionalText(
      issuer.name ??
        source.issuerName ??
        source.issuer_name ??
        source.emisorNombre,
    ),
    receiverRfc: text(
      receiver.rfc ??
        source.receiverRfc ??
        source.receiver_rfc ??
        source.receptorRfc,
    ),
    receiverName: optionalText(
      receiver.name ??
        source.receiverName ??
        source.receiver_name ??
        source.receptorNombre,
    ),
    receiverFiscalZip: optionalText(
      receiver.fiscalZip ??
        source.receiverFiscalZip ??
        source.receiver_fiscal_zip,
    ),
    receiverFiscalRegimeCode: optionalText(
      receiver.fiscalRegimeCode ??
        source.receiverFiscalRegimeCode ??
        source.receiver_fiscal_regime_code,
    ),
    usageCode: optionalText(
      receiver.usageCode ?? source.usageCode ?? source.usage_code,
    ),
    total: text(source.total, "0"),
    subtotal: text(source.subtotal ?? source.subTotal, "0"),
    discount: optionalText(source.discount ?? source.descuento),
    currency: text(source.currency ?? source.moneda, "MXN"),
    exchangeRate: optionalText(source.exchangeRate ?? source.exchange_rate),
    paymentForm: optionalText(source.paymentForm ?? source.payment_form),
    paymentMethod: optionalText(source.paymentMethod ?? source.payment_method),
    placeOfIssue: optionalText(source.placeOfIssue ?? source.place_of_issue),
    exportCode: optionalText(source.exportCode ?? source.export_code),
    createdAt: text(source.createdAt ?? source.created_at),
    updatedAt: text(source.updatedAt ?? source.updated_at),
    recordVersion: integer(source.recordVersion ?? source.record_version),
  };
}

function normalizeConcept(value: unknown): CfdiConcept {
  const source = record(value);
  return {
    id: text(source.id),
    productServiceCode: text(
      source.productServiceCode ??
        source.product_service_code ??
        source.claveProdServ,
    ),
    identificationNumber: optionalText(
      source.identificationNumber ??
        source.identification_number ??
        source.noIdentificacion,
    ),
    quantity: text(source.quantity ?? source.cantidad, "0"),
    unitCode: text(source.unitCode ?? source.unit_code ?? source.claveUnidad),
    unit: optionalText(
      source.unitName ?? source.unit_name ?? source.unit ?? source.unidad,
    ),
    description: text(source.description ?? source.descripcion),
    unitValue: text(
      source.unitValue ?? source.unit_value ?? source.valorUnitario,
      "0",
    ),
    amount: text(source.amount ?? source.importe, "0"),
    discount: optionalText(source.discount ?? source.descuento),
  };
}

function normalizeTax(value: unknown): CfdiTax {
  const source = record(value);
  const kind = text(
    source.direction ?? source.kind ?? source.taxType ?? source.tax_type,
  ).toLowerCase();
  return {
    id: text(source.id),
    conceptId: optionalText(source.conceptId ?? source.concept_id),
    scope: optionalText(source.conceptId ?? source.concept_id)
      ? "concept"
      : ((["concept", "payment", "payment_document"].includes(
          text(source.scopeType ?? source.scope).toLowerCase(),
        )
          ? text(source.scopeType ?? source.scope).toLowerCase()
          : "document") as CfdiTax["scope"]),
    kind: ["withholding", "withheld", "retencion", "retención"].includes(kind)
      ? "withholding"
      : "transfer",
    taxCode: text(source.taxCode ?? source.tax_code ?? source.impuesto),
    factorType: optionalText(
      source.factorType ?? source.factor_type ?? source.tipoFactor,
    ),
    base: optionalText(source.baseAmount ?? source.base),
    rateOrQuota: optionalText(
      source.rateOrQuota ?? source.rate_or_quota ?? source.tasaOCuota,
    ),
    amount: optionalText(source.amount ?? source.importe),
  };
}

function normalizeRelation(value: unknown): CfdiRelation {
  const source = record(value);
  return {
    id: text(source.id),
    relationType: text(
      source.relationType ?? source.relation_type ?? source.tipoRelacion,
    ),
    relatedUuid: text(source.relatedUuid ?? source.related_uuid ?? source.uuid),
  };
}

function normalizePaymentDocument(value: unknown): CfdiPaymentDocument {
  const source = record(value);
  const partiality =
    source.installmentNumber ??
    source.installment_number ??
    source.partialityNumber ??
    source.partiality_number ??
    source.numParcialidad;
  return {
    id: text(source.id),
    paymentId: optionalText(source.paymentId ?? source.payment_id),
    relatedUuid: text(
      source.relatedUuid ?? source.related_uuid ?? source.idDocumento,
    ),
    currency: text(source.currency ?? source.monedaDr, "MXN"),
    partialityNumber:
      typeof partiality === "number" && Number.isFinite(partiality)
        ? Math.trunc(partiality)
        : typeof partiality === "string" && /^\d+$/.test(partiality)
          ? Number(partiality)
          : null,
    previousBalance: optionalText(
      source.previousBalance ?? source.previous_balance ?? source.impSaldoAnt,
    ),
    paidAmount: optionalText(
      source.paidAmount ?? source.paid_amount ?? source.impPagado,
    ),
    outstandingBalance: optionalText(
      source.remainingBalance ??
        source.remaining_balance ??
        source.outstandingBalance ??
        source.outstanding_balance ??
        source.impSaldoInsoluto,
    ),
    taxObject: optionalText(
      source.taxObjectCode ??
        source.tax_object_code ??
        source.taxObject ??
        source.tax_object ??
        source.objetoImpDr,
    ),
  };
}

function normalizePayment(value: unknown): CfdiPayment {
  const source = record(value);
  return {
    id: text(source.id),
    paidAt: text(
      source.paymentDate ??
        source.payment_date ??
        source.paidAt ??
        source.paid_at ??
        source.fechaPago,
    ),
    paymentForm: text(
      source.paymentForm ?? source.payment_form ?? source.formaDePagoP,
    ),
    currency: text(source.currency ?? source.monedaP, "MXN"),
    exchangeRate: optionalText(
      source.exchangeRate ?? source.exchange_rate ?? source.tipoCambioP,
    ),
    amount: text(source.amount ?? source.monto, "0"),
    operationNumber: optionalText(
      source.operationNumber ?? source.operation_number ?? source.numOperacion,
    ),
    payerBankRfc: optionalText(
      source.payerBankRfc ?? source.payer_bank_rfc ?? source.rfcEmisorCtaOrd,
    ),
    payerForeignBankName: optionalText(
      source.payerForeignBankName ??
        source.payer_foreign_bank_name ??
        source.nomBancoOrdExt,
    ),
    payerAccount: optionalText(
      source.payerAccount ?? source.payer_account ?? source.ctaOrdenante,
    ),
    beneficiaryBankRfc: optionalText(
      source.beneficiaryBankRfc ??
        source.beneficiary_bank_rfc ??
        source.rfcEmisorCtaBen,
    ),
    beneficiaryAccount: optionalText(
      source.beneficiaryAccount ??
        source.beneficiary_account ??
        source.ctaBeneficiario,
    ),
    documents: entries(
      source.documents ?? source.paymentDocuments ?? source.payment_documents,
    ).map(normalizePaymentDocument),
  };
}

function normalizePayroll(value: unknown): CfdiPayroll | null {
  if (!value || typeof value !== "object") return null;
  const source = record(value);
  if (source.restricted === true) return null;
  return {
    payrollVersion: text(
      source.payrollVersion ?? source.payroll_version,
      "1.2",
    ),
    payrollType: text(
      source.payrollType ?? source.payroll_type ?? source.tipoNomina,
    ),
    paymentDate: text(
      source.paymentDate ?? source.payment_date ?? source.fechaPago,
    ),
    initialPaymentDate: text(
      source.initialPaymentDate ??
        source.initial_payment_date ??
        source.fechaInicialPago,
    ),
    finalPaymentDate: text(
      source.finalPaymentDate ??
        source.final_payment_date ??
        source.fechaFinalPago,
    ),
    daysPaid: text(
      source.paidDays ??
        source.paid_days ??
        source.daysPaid ??
        source.days_paid ??
        source.numDiasPagados,
    ),
    employeeCurp: optionalText(
      source.employeeCurp ?? source.employee_curp ?? source.curp,
    ),
    employeeNumber: optionalText(
      source.employeeNumber ?? source.employee_number ?? source.numEmpleado,
    ),
    employerRegistration: optionalText(
      source.employerRegistration ?? source.employer_registration,
    ),
    employeeSocialSecurityNumber: optionalText(
      source.employeeSocialSecurityNumber ??
        source.employee_social_security_number,
    ),
    regimeType: optionalText(source.regimeType ?? source.regime_type),
    contractType: optionalText(source.contractType ?? source.contract_type),
    position: optionalText(source.position),
    paymentPeriodicity: optionalText(
      source.paymentPeriodicity ?? source.payment_periodicity,
    ),
    baseSalary: optionalText(source.baseSalary ?? source.base_salary),
    integratedDailySalary: optionalText(
      source.integratedDailySalary ?? source.integrated_daily_salary,
    ),
    totalPerceptions: optionalText(
      source.totalPerceptions ??
        source.total_perceptions ??
        source.totalPercepciones,
    ),
    totalDeductions: optionalText(
      source.totalDeductions ??
        source.total_deductions ??
        source.totalDeducciones,
    ),
    totalOtherPayments: optionalText(
      source.totalOtherPayments ??
        source.total_other_payments ??
        source.totalOtrosPagos,
    ),
    perceptions: entries(source.perceptions).map((entry) => {
      const perception = record(entry);
      return {
        ordinal: integer(perception.ordinal),
        type: text(perception.perceptionType ?? perception.perception_type),
        key: text(perception.key),
        concept: text(perception.concept),
        taxableAmount: text(
          perception.taxableAmount ?? perception.taxable_amount,
          "0",
        ),
        exemptAmount: text(
          perception.exemptAmount ?? perception.exempt_amount,
          "0",
        ),
      };
    }),
    deductions: entries(source.deductions).map((entry) => {
      const deduction = record(entry);
      return {
        ordinal: integer(deduction.ordinal),
        type: text(deduction.deductionType ?? deduction.deduction_type),
        key: text(deduction.key),
        concept: text(deduction.concept),
        amount: text(deduction.amount, "0"),
      };
    }),
    otherPayments: entries(source.otherPayments ?? source.other_payments).map(
      (entry) => {
        const payment = record(entry);
        return {
          ordinal: integer(payment.ordinal),
          type: text(payment.otherPaymentType ?? payment.other_payment_type),
          key: text(payment.key),
          concept: text(payment.concept),
          amount: text(payment.amount, "0"),
        };
      },
    ),
    incapacities: entries(source.incapacities).map((entry) => {
      const incapacity = record(entry);
      return {
        ordinal: integer(incapacity.ordinal),
        days: text(
          incapacity.incapacityDays ?? incapacity.incapacity_days,
          "0",
        ),
        type: text(incapacity.incapacityType ?? incapacity.incapacity_type),
        amount: optionalText(incapacity.amount),
      };
    }),
  };
}

export function normalizeCfdiDetail(value: unknown): CfdiDetail {
  const root = unwrap(value);
  const source = record(root.cfdi ?? root);
  const standaloneDocuments = entries(
    root.paymentDocuments ?? source.paymentDocuments,
  ).map(normalizePaymentDocument);
  const payments = entries(root.payments ?? source.payments).map((entry) => {
    const payment = normalizePayment(entry);
    return payment.documents.length
      ? payment
      : {
          ...payment,
          documents: standaloneDocuments.filter(
            (document) => document.paymentId === payment.id,
          ),
        };
  });
  return {
    ...normalizeCfdiListItem(source),
    concepts: entries(root.concepts ?? source.concepts).map(normalizeConcept),
    taxes: entries(root.taxes ?? source.taxes).map(normalizeTax),
    relations: entries(root.relations ?? source.relations).map(
      normalizeRelation,
    ),
    payments,
    payroll: normalizePayroll(root.payroll ?? source.payroll),
    provenance: entries(root.provenance ?? source.provenance).map((entry) => {
      const provenance = record(entry);
      return {
        id: text(provenance.id),
        objectId: optionalText(provenance.objectId ?? provenance.object_id),
        jobId: optionalText(
          provenance.ingestionJobId ??
            provenance.ingestion_job_id ??
            provenance.jobId ??
            provenance.job_id,
        ),
        observedAt: optionalText(
          provenance.observedAt ?? provenance.observed_at,
        ),
        parserVersion: optionalText(
          provenance.parserVersion ?? provenance.parser_version,
        ),
        schemaVersion: optionalText(
          provenance.schemaVersion ?? provenance.schema_version,
        ),
        parsedCfdiVersion: optionalText(
          provenance.parsedCfdiVersion ?? provenance.parsed_cfdi_version,
        ),
        result: optionalText(
          provenance.productResult ?? provenance.product_result,
        ),
        processedAt: optionalText(
          provenance.processedAt ?? provenance.processed_at,
        ),
      };
    }),
    periods: entries(root.periods ?? source.periods).map((entry) => {
      const period = record(entry);
      return {
        id: text(period.id),
        year: integer(period.year),
        month: integer(period.month),
        participationType: text(
          period.participationType ?? period.participation_type,
        ),
        policyVersion: text(period.policyVersion ?? period.policy_version),
        timezone: text(period.timezone, "America/Mexico_City"),
        sourceDate: text(period.sourceDate ?? period.source_date),
        origin: text(period.origin, "automatic"),
      };
    }),
    incidents: entries(root.incidents ?? source.incidents).map((entry) => {
      const incident = record(entry);
      return {
        id: text(incident.id),
        code: text(incident.code),
        severity: text(incident.severity),
        status: text(incident.status),
        safeDetail: optionalText(incident.safeDetail ?? incident.safe_detail),
        createdAt: optionalText(
          incident.detectedAt ??
            incident.detected_at ??
            incident.createdAt ??
            incident.created_at,
        ),
      };
    }),
  };
}

export function normalizeCfdiPage(value: unknown): CfdiPage {
  const body = unwrap(value);
  const values = Array.isArray(body.items) ? body.items : [];
  const items = values.map(normalizeCfdiListItem);
  return { items, meta: meta(body.meta, items.length) };
}
