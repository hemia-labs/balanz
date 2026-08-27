import assert from "node:assert/strict";
import test from "node:test";
import {
  clearClientListState,
  clientListQueryValue,
  clientSearchQuery,
  editClientSearchDraft,
  initialClientListLoadState,
  normalizeClientListSearch,
  rebaseClientSearchDraft,
  rejectClientListLoad,
  resolveClientListLoad,
  resolveClientSearchDraft,
  selectClientListLoad,
  shouldSyncClientSearch,
  startClientListLoad,
} from "./client-list-query";
import type { ClientPage } from "./types";

test("navegar entre páginas no reinicia una búsqueda que no cambió", () => {
  assert.equal(clientSearchQuery("search=Acme&page=7", " Acme "), null);
  assert.equal(clientSearchQuery("page=4", ""), null);

  assert.equal(
    clientListQueryValue("search=Acme&page=7", "page", "8"),
    "search=Acme&page=8",
  );
});

test("un cambio real de búsqueda vuelve a la primera página", () => {
  assert.equal(
    clientSearchQuery("search=Acme&page=7&status=active", "Beta"),
    "search=Beta&page=1&status=active",
  );
  assert.equal(
    clientSearchQuery("search=Acme&page=7&status=active", "   "),
    "page=1&status=active",
  );
});

test("los otros filtros reinician página sólo cuando su valor cambia", () => {
  assert.equal(
    clientListQueryValue("status=active&page=5", "status", "active"),
    null,
  );
  assert.equal(
    clientListQueryValue("status=active&page=5", "status", "suspended"),
    "status=suspended&page=1",
  );
  assert.equal(
    clientListQueryValue("sort=name&page=3", "sort", "updatedAt"),
    "sort=updatedAt&page=1",
  );
});

test("un cambio externo de URL reemplaza el draft local", () => {
  const draft = editClientSearchDraft("Acme", "edición local");
  assert.equal(resolveClientSearchDraft(draft, "Acme"), "edición local");
  assert.equal(resolveClientSearchDraft(draft, "Beta"), "Beta");
});

test("la navegación externa rebasa el draft y no lo resucita al volver", () => {
  const edited = editClientSearchDraft("Acme", "Beta");
  assert.equal(shouldSyncClientSearch(edited, "Beta", "Acme", "Beta"), false);
  const atBeta = rebaseClientSearchDraft(edited, "Beta");
  assert.deepEqual(atBeta, { base: "Beta", value: "Beta" });
  assert.equal(shouldSyncClientSearch(atBeta, "Beta", "Acme", "Beta"), false);
  assert.equal(shouldSyncClientSearch(atBeta, "Beta", "Beta", "Beta"), true);
  const backAtAcme = rebaseClientSearchDraft(atBeta, "Acme");
  assert.deepEqual(backAtAcme, { base: "Acme", value: "Acme" });
  assert.equal(resolveClientSearchDraft(backAtAcme, "Acme"), "Acme");
});

test("limpiar filtros borra URL y draft antes y después de navegar", () => {
  const cleared = clearClientListState("Acme");
  assert.equal(cleared.query, "");
  assert.equal(resolveClientSearchDraft(cleared.searchDraft, "Acme"), "");
  assert.equal(resolveClientSearchDraft(cleared.searchDraft, ""), "");
});

test("la búsqueda visible respeta el máximo del contrato", () => {
  assert.equal(normalizeClientListSearch(`  ${"x".repeat(140)}`).length, 120);
  assert.equal(
    clientSearchQuery(
      `search=${"x".repeat(140)}&page=7`,
      "x".repeat(120),
    ),
    `search=${"x".repeat(120)}&page=7`,
  );
});

test("un cambio de organización o consulta oculta resultados anteriores", () => {
  const requestA = { organizationId: "org-a", queryKey: "page=2", requestId: 1 };
  const requestB = { organizationId: "org-b", queryKey: "page=2", requestId: 2 };
  const pageA = {
    items: [],
    meta: { page: 2, limit: 25, total: 0, totalPages: 0 },
  } as ClientPage;

  const loadingA = startClientListLoad(requestA);
  const readyA = resolveClientListLoad(loadingA, requestA, pageA);
  assert.equal(selectClientListLoad(readyA, "org-a", "page=2").page, pageA);
  assert.deepEqual(selectClientListLoad(readyA, "org-b", "page=2"), {
    page: null,
    error: null,
    loading: true,
  });
  assert.deepEqual(selectClientListLoad(readyA, "org-a", "page=3"), {
    page: null,
    error: null,
    loading: true,
  });

  const loadingB = startClientListLoad(requestB);
  assert.equal(resolveClientListLoad(loadingB, requestA, pageA), loadingB);
  const staleError = rejectClientListLoad(
    loadingB,
    requestA,
    new Error("respuesta anterior"),
  );
  assert.equal(staleError, loadingB);
});

test("el estado inicial nunca expone una cartera sin identidad", () => {
  assert.deepEqual(selectClientListLoad(initialClientListLoadState, "org", ""), {
    page: null,
    error: null,
    loading: true,
  });
});
