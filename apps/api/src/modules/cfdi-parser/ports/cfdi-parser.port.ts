import type { Readable } from 'node:stream';

export const CFDI_40_NAMESPACE = 'http://www.sat.gob.mx/cfd/4' as const;
export const TFD_11_NAMESPACE =
  'http://www.sat.gob.mx/TimbreFiscalDigital' as const;
export const PAYMENTS_20_NAMESPACE = 'http://www.sat.gob.mx/Pagos20' as const;
export const PAYROLL_12_NAMESPACE = 'http://www.sat.gob.mx/nomina12' as const;

export const CFDI_PARSER_VERSION = 'balanz-cfdi-saxes/1.0.0' as const;
export const CFDI_SCHEMA_SET_VERSION =
  'sat-cfdi-4.0+tfd-1.1+pagos-2.0+nomina-1.2@2026-09-03' as const;

/** A decimal is intentionally represented by its exact XML lexical value. */
export type ExactDecimal = string;
export type CfdiDocumentType = 'I' | 'E' | 'T' | 'N' | 'P';

export interface CfdiTaxLine {
  kind: 'transfer' | 'withholding';
  base?: ExactDecimal;
  tax: string;
  factorType?: string;
  rateOrQuota?: ExactDecimal;
  amount?: ExactDecimal;
}

export interface CfdiTaxes {
  totalTransferred?: ExactDecimal;
  totalWithheld?: ExactDecimal;
  lines: CfdiTaxLine[];
}

export interface CfdiConcept {
  productServiceCode: string;
  identificationNumber?: string;
  quantity: ExactDecimal;
  unitCode?: string;
  unit?: string;
  description: string;
  unitValue: ExactDecimal;
  amount: ExactDecimal;
  discount?: ExactDecimal;
  taxObject?: string;
  taxes: CfdiTaxes;
}

export interface CfdiRelation {
  relationGroupOrdinal: number;
  relationOrdinal: number;
  relationType: string;
  relatedUuid: string;
}

export interface CfdiParty {
  rfc: string;
  name?: string;
  fiscalRegime?: string;
}

export interface CfdiReceiver extends CfdiParty {
  fiscalAddress?: string;
  taxResidence?: string;
  foreignTaxRegistration?: string;
  cfdiUse?: string;
}

export interface CfdiStamp {
  version: '1.1';
  uuid: string;
  stampedAt: string;
  certifyingProviderRfc: string;
  satCertificateNumber: string;
  cfdiSeal: string;
  satSeal: string;
}

export interface CfdiPaymentDocument {
  uuid: string;
  series?: string;
  folio?: string;
  currency: string;
  equivalence?: ExactDecimal;
  partialityNumber: string;
  previousBalance: ExactDecimal;
  paidAmount: ExactDecimal;
  unpaidBalance: ExactDecimal;
  taxObject?: string;
  taxes: CfdiTaxes;
}

export interface CfdiPayment {
  paidAt: string;
  paymentForm: string;
  currency: string;
  exchangeRate?: ExactDecimal;
  amount: ExactDecimal;
  operationNumber?: string;
  payerRfc?: string;
  payerForeignBankName?: string;
  payerAccount?: string;
  beneficiaryRfc?: string;
  beneficiaryAccount?: string;
  paymentChainType?: string;
  certificate?: string;
  paymentChain?: string;
  signature?: string;
  relatedDocuments: CfdiPaymentDocument[];
  taxes: CfdiTaxes;
}

export interface CfdiPaymentTotals {
  totalPayments: ExactDecimal;
  totalWithheldVat?: ExactDecimal;
  totalWithheldIncomeTax?: ExactDecimal;
  totalWithheldExciseTax?: ExactDecimal;
  totalTransferredVatBase16?: ExactDecimal;
  totalTransferredVatTax16?: ExactDecimal;
  totalTransferredVatBase8?: ExactDecimal;
  totalTransferredVatTax8?: ExactDecimal;
  totalTransferredVatBase0?: ExactDecimal;
  totalTransferredVatTax0?: ExactDecimal;
  totalTransferredVatBaseExempt?: ExactDecimal;
}

export interface CfdiPaymentsComplement {
  version: '2.0';
  totals: CfdiPaymentTotals;
  payments: CfdiPayment[];
}

export interface CfdiPayrollIssuer {
  curp?: string;
  employerRegistration?: string;
  sourceEmployerRfc?: string;
}

export interface CfdiPayrollReceiver {
  curp: string;
  socialSecurityNumber?: string;
  employmentStartDate?: string;
  seniority?: string;
  contractType: string;
  unionized?: string;
  workdayType?: string;
  regimeType: string;
  employeeNumber: string;
  department?: string;
  position?: string;
  occupationalRisk?: string;
  paymentFrequency: string;
  bank?: string;
  bankAccount?: string;
  contributionBaseSalary?: ExactDecimal;
  integratedDailySalary?: ExactDecimal;
  federalEntityCode: string;
}

export interface CfdiPayrollPerception {
  perceptionType: string;
  code: string;
  description: string;
  taxableAmount: ExactDecimal;
  exemptAmount: ExactDecimal;
}

export interface CfdiPayrollDeduction {
  deductionType: string;
  code: string;
  description: string;
  amount: ExactDecimal;
}

export interface CfdiPayrollOtherPayment {
  otherPaymentType: string;
  code: string;
  description: string;
  amount: ExactDecimal;
  employmentSubsidy?: ExactDecimal;
  positiveBalance?: ExactDecimal;
  positiveBalanceYear?: string;
  remainingPositiveBalance?: ExactDecimal;
}

export interface CfdiPayrollIncapacity {
  days: ExactDecimal;
  incapacityType: string;
  amount?: ExactDecimal;
}

export interface CfdiPayrollComplement {
  version: '1.2';
  payrollType: string;
  paymentDate: string;
  initialPaymentDate: string;
  finalPaymentDate: string;
  paidDays: ExactDecimal;
  totalPerceptions?: ExactDecimal;
  totalDeductions?: ExactDecimal;
  totalOtherPayments?: ExactDecimal;
  issuer?: CfdiPayrollIssuer;
  receiver: CfdiPayrollReceiver;
  perceptions: CfdiPayrollPerception[];
  deductions: CfdiPayrollDeduction[];
  otherPayments: CfdiPayrollOtherPayment[];
  incapacities: CfdiPayrollIncapacity[];
}

export interface UnsupportedCfdiComplement {
  namespaceUri: string;
  localName: string;
}

export interface ParsedCfdi {
  version: '4.0';
  series?: string;
  folio?: string;
  issuedAt: string;
  stamp: CfdiStamp;
  paymentForm?: string;
  certificateNumber?: string;
  certificate?: string;
  subtotal: ExactDecimal;
  discount?: ExactDecimal;
  currency: string;
  exchangeRate?: ExactDecimal;
  total: ExactDecimal;
  documentType: CfdiDocumentType;
  exportCode?: string;
  paymentMethod?: string;
  issueLocation: string;
  confirmation?: string;
  issuer: CfdiParty;
  receiver: CfdiReceiver;
  concepts: CfdiConcept[];
  taxes: CfdiTaxes;
  relations: CfdiRelation[];
  payments?: CfdiPaymentsComplement;
  payroll?: CfdiPayrollComplement;
  unsupportedComplements: UnsupportedCfdiComplement[];
}

export interface CfdiParseResult {
  parserVersion: typeof CFDI_PARSER_VERSION;
  schemaVersion: typeof CFDI_SCHEMA_SET_VERSION;
  sizeBytes: number;
  document: ParsedCfdi;
}

export interface CfdiParseOptions {
  signal?: AbortSignal;
}

export interface CfdiParserPort {
  parse(input: Readable, options?: CfdiParseOptions): Promise<CfdiParseResult>;
}
