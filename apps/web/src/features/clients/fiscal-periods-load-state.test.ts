import assert from "node:assert/strict";
import test from "node:test";
import {
  rejectFiscalPeriodsLoad,
  resolveFiscalPeriodsLoad,
  selectFiscalPeriodsLoad,
  startFiscalPeriodsLoad,
  type FiscalPeriodsQueryKey,
  type FiscalPeriodsRequest,
} from "./fiscal-periods-load-state";
import type { PeriodsResponse } from "./types";

function query(
  legalEntityId: string,
  year = "2026",
): FiscalPeriodsQueryKey {
  return {
    organizationId: "despacho-1",
    clientId: "cliente-1",
    legalEntityId,
    year,
  };
}

function request(
  requestId: number,
  legalEntityId: string,
  year = "2026",
): FiscalPeriodsRequest {
  return { ...query(legalEntityId, year), requestId };
}

function response(legalEntityId: string, year = 2026): PeriodsResponse {
  return {
    fiscalYear: {
      id: `year-${legalEntityId}-${year}`,
      clientAccountId: "cliente-1",
      legalEntityId,
      year,
      status: "active",
      version: 1,
    },
    periods: [
      {
        id: `period-${legalEntityId}-${year}`,
        fiscalYearId: `year-${legalEntityId}-${year}`,
        month: 1,
        status: "not_started",
        cutoffAt: null,
        lockVersion: 0,
      },
    ],
  };
}

test("invalida períodos antes del efecto al cambiar RFC o ejercicio", () => {
  const requestA = request(1, "rfc-a", "2026");
  const readyA = resolveFiscalPeriodsLoad(
    startFiscalPeriodsLoad(requestA),
    requestA,
    response("rfc-a", 2026),
  );
  const forOtherRfc = selectFiscalPeriodsLoad(readyA, query("rfc-b", "2026"));
  const forOtherYear = selectFiscalPeriodsLoad(readyA, query("rfc-a", "2025"));
  assert.equal(forOtherRfc.status, "loading");
  assert.equal(forOtherRfc.data, null);
  assert.equal(forOtherYear.status, "loading");
  assert.equal(forOtherYear.data, null);
});

test("ignora respuestas y errores obsoletos", () => {
  const oldRequest = request(1, "rfc-a");
  const currentRequest = request(2, "rfc-b");
  const current = startFiscalPeriodsLoad(currentRequest);
  assert.strictEqual(
    resolveFiscalPeriodsLoad(current, oldRequest, response("rfc-a")),
    current,
  );
  assert.strictEqual(
    rejectFiscalPeriodsLoad(current, oldRequest, new Error("anterior")),
    current,
  );
});

test("ignora una respuesta anterior para la misma llave", () => {
  const current = startFiscalPeriodsLoad(request(4, "rfc-a"));
  assert.strictEqual(
    resolveFiscalPeriodsLoad(
      current,
      request(3, "rfc-a"),
      response("rfc-a"),
    ),
    current,
  );
});

test("un error vigente limpia los períodos", () => {
  const currentRequest = request(5, "rfc-a");
  const error = new Error("fallo vigente");
  const rejected = rejectFiscalPeriodsLoad(
    startFiscalPeriodsLoad(currentRequest),
    currentRequest,
    error,
  );
  assert.equal(rejected.status, "error");
  assert.equal(rejected.data, null);
  assert.strictEqual(rejected.error, error);
});
