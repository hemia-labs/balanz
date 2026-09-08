import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCfdiDetail, normalizeCfdiPage } from "./types";

test("normaliza múltiples pagos y documentos relacionados", () => {
  const detail = normalizeCfdiDetail({
    cfdi: {
      id: "cfdi",
      uuid: "UUID",
      type: "P",
      total: "0.00",
    },
    payments: [
      {
        id: "payment-a",
        amount: "100.00",
        documents: [
          { id: "document-a", relatedUuid: "A", paidAmount: "40.00" },
          { id: "document-b", relatedUuid: "B", paidAmount: "60.00" },
        ],
      },
      { id: "payment-b", amount: "25.00", documents: [] },
    ],
  });
  assert.equal(detail.payments.length, 2);
  assert.equal(detail.payments[0].documents.length, 2);
  assert.equal(detail.payments[0].documents[1].paidAmount, "60.00");
});

test("mantiene separado el banco extranjero de la cuenta ordenante", () => {
  const bankName =
    "BANCO SINTÉTICO INTERNACIONAL CON NOMBRE MAYOR A CINCUENTA CARACTERES";
  const detail = normalizeCfdiDetail({
    id: "cfdi-payment-bank",
    documentType: "P",
    payments: [
      {
        id: "payment-a",
        amount: "100.000000",
        payer_foreign_bank_name: bankName,
        payer_account: "SYNTHETIC-ACCOUNT-001",
      },
    ],
    taxes: [
      {
        id: "tax-a",
        scope_type: "payment",
        direction: "withheld",
        tax_code: "002",
        factor_type: null,
        amount: "10.000000",
      },
    ],
  });

  assert.equal(detail.payments[0].payerForeignBankName, bankName);
  assert.equal(detail.payments[0].payerAccount, "SYNTHETIC-ACCOUNT-001");
  assert.equal(detail.taxes[0].factorType, null);
});

test("agrupa los DoctoRelacionado que la API entrega en colección separada", () => {
  const detail = normalizeCfdiDetail({
    id: "cfdi",
    uuid: "123e4567-e89b-12d3-a456-426614174000",
    version: "4.0",
    documentType: "P",
    total: "0.000000",
    payments: [
      {
        id: "payment-a",
        paymentDate: "2026-09-01T18:00:00.000Z",
        amount: "100.000000",
      },
      {
        id: "payment-b",
        paymentDate: "2026-09-02T18:00:00.000Z",
        amount: "25.000000",
      },
    ],
    paymentDocuments: [
      {
        id: "document-a",
        paymentId: "payment-a",
        relatedUuid: "A",
        paidAmount: "40.000000",
      },
      {
        id: "document-b",
        paymentId: "payment-a",
        relatedUuid: "B",
        paidAmount: "60.000000",
      },
      {
        id: "document-c",
        paymentId: "payment-b",
        relatedUuid: "C",
        paidAmount: "25.000000",
      },
    ],
  });
  assert.deepEqual(
    detail.payments.map((payment) =>
      payment.documents.map((document) => document.id),
    ),
    [["document-a", "document-b"], ["document-c"]],
  );
});

test("normaliza paginación y campos monetarios como strings", () => {
  const page = normalizeCfdiPage({
    items: [{ id: "cfdi", uuid: "UUID", type: "I", total: "10.0000" }],
    meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  assert.equal(page.items[0].total, "10.0000");
  assert.equal(page.meta.total, 1);
});

test("normaliza nómina core sólo desde el bloque autorizado de la API", () => {
  const detail = normalizeCfdiDetail({
    id: "cfdi-nomina",
    uuid: "123e4567-e89b-12d3-a456-426614174000",
    version: "4.0",
    documentType: "N",
    receiver: { rfc: "AAA010101AAA" },
    total: "1000.000000",
    payroll: {
      payrollVersion: "1.2",
      payrollType: "O",
      employeeCurp: "AAAA010101HDFBBB01",
      perceptions: [
        {
          ordinal: 1,
          perceptionType: "001",
          key: "P001",
          concept: "Sueldo",
          taxableAmount: "900.000000",
          exemptAmount: "100.000000",
        },
      ],
      deductions: [],
      otherPayments: [],
      incapacities: [],
    },
  });
  assert.equal(detail.payroll?.payrollVersion, "1.2");
  assert.equal(detail.payroll?.perceptions[0].taxableAmount, "900.000000");

  const restricted = normalizeCfdiDetail({
    id: "cfdi-nomina",
    documentType: "N",
    payroll: { restricted: true },
  });
  assert.equal(restricted.payroll, null);
});
