import assert from "node:assert/strict";
import test from "node:test";
import {
  initialFiscalYearsLoadState,
  rejectFiscalYearsLoad,
  resolveFiscalYearsLoad,
  selectFiscalYearsLoad,
  startFiscalYearsLoad,
  type FiscalYearsQueryKey,
  type FiscalYearsRequest,
} from "./fiscal-years-load-state";
import type { CollectionPage, FiscalYear } from "./types";

function query(legalEntityId: string, revision = 0): FiscalYearsQueryKey {
  return {
    organizationId: "despacho-1",
    clientId: "cliente-1",
    legalEntityId,
    page: 1,
    revision,
  };
}

function request(
  requestId: number,
  legalEntityId: string,
  revision = 0,
): FiscalYearsRequest {
  return { ...query(legalEntityId, revision), requestId };
}

function year(id: string, legalEntityId: string): FiscalYear {
  return {
    id,
    clientAccountId: "cliente-1",
    legalEntityId,
    year: 2026,
    status: "active",
    version: 1,
  };
}

function page(items: FiscalYear[]): CollectionPage<FiscalYear> {
  return {
    items,
    meta: { page: 1, limit: 25, total: items.length, totalPages: 1 },
  };
}

test("invalida los ejercicios antes del efecto al cambiar de RFC", () => {
  const requestA = request(1, "rfc-a");
  const readyA = resolveFiscalYearsLoad(
    startFiscalYearsLoad(requestA),
    requestA,
    page([year("year-a", "rfc-a")]),
  );

  const visibleForB = selectFiscalYearsLoad(readyA, query("rfc-b"));
  assert.equal(visibleForB.status, "loading");
  assert.deepEqual(visibleForB.years, []);
  assert.equal(visibleForB.error, null);
});

test("inicia cada carga sin conservar ejercicios ni errores anteriores", () => {
  const next = startFiscalYearsLoad(request(2, "rfc-b"));
  assert.equal(next.status, "loading");
  assert.equal(next.request?.legalEntityId, "rfc-b");
  assert.deepEqual(next.years, []);
  assert.equal(next.error, null);
});

test("ignora una respuesta tardía del RFC anterior", () => {
  const requestA = request(1, "rfc-a");
  const requestB = request(2, "rfc-b");
  const current = startFiscalYearsLoad(requestB);
  const staleResult = resolveFiscalYearsLoad(
    current,
    requestA,
    page([year("year-a", "rfc-a")]),
  );
  assert.strictEqual(staleResult, current);
  assert.deepEqual(staleResult.years, []);
});

test("ignora una respuesta anterior al recargar el mismo RFC", () => {
  const current = startFiscalYearsLoad(request(4, "rfc-a", 1));
  const staleResult = resolveFiscalYearsLoad(
    current,
    request(3, "rfc-a", 0),
    page([year("year-old", "rfc-a")]),
  );
  assert.strictEqual(staleResult, current);
});

test("un error vigente no conserva datos y uno obsoleto no reemplaza el estado", () => {
  const requestB = request(7, "rfc-b");
  const current = startFiscalYearsLoad(requestB);
  const staleError = rejectFiscalYearsLoad(
    current,
    request(6, "rfc-a"),
    new Error("fallo anterior"),
  );
  assert.strictEqual(staleError, current);

  const error = new Error("fallo vigente");
  const rejected = rejectFiscalYearsLoad(current, requestB, error);
  assert.equal(rejected.status, "error");
  assert.deepEqual(rejected.years, []);
  assert.strictEqual(rejected.error, error);
  assert.deepEqual(initialFiscalYearsLoadState.years, []);
});

test("un cambio de organización, cliente o revisión invalida la vista", () => {
  const activeRequest = request(1, "rfc-a");
  const ready = resolveFiscalYearsLoad(
    startFiscalYearsLoad(activeRequest),
    activeRequest,
    page([year("year-a", "rfc-a")]),
  );
  assert.equal(
    selectFiscalYearsLoad(ready, {
      ...query("rfc-a"),
      organizationId: "despacho-2",
    }).status,
    "loading",
  );
  assert.equal(
    selectFiscalYearsLoad(ready, {
      ...query("rfc-a"),
      clientId: "cliente-2",
    }).status,
    "loading",
  );
  assert.equal(
    selectFiscalYearsLoad(ready, query("rfc-a", 1)).status,
    "loading",
  );
});
