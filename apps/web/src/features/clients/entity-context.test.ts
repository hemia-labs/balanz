import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../lib/api-client";
import {
  COLLECTION_PAGE_MAX,
  DOMAIN_SEARCH_MAX_LENGTH,
  entityContextSuffix,
  fiscalEntitySelectorHref,
  isLegalEntityRouteUnavailableError,
  legalEntityDetailQuery,
  normalizeCollectionPage,
  normalizeDomainSearch,
  resolveEntitySearchDraft,
} from "./entity-context";

test("normaliza páginas inválidas sin generar consultas fuera de rango", () => {
  assert.equal(normalizeCollectionPage("3"), 3);
  assert.equal(normalizeCollectionPage(null), 1);
  assert.equal(normalizeCollectionPage("0"), 1);
  assert.equal(normalizeCollectionPage("2.5"), 1);
  assert.equal(normalizeCollectionPage("invalida"), 1);
  assert.equal(normalizeCollectionPage(String(COLLECTION_PAGE_MAX)), 10_000);
  assert.equal(normalizeCollectionPage("10001"), 1);
  assert.equal(normalizeCollectionPage("1e24"), 1);
});

test("conserva página y búsqueda de RFC en enlaces fiscales", () => {
  assert.equal(entityContextSuffix(1, ""), "");
  assert.equal(entityContextSuffix(2, ""), "?entityPage=2");
  assert.equal(
    entityContextSuffix(3, "  ABC 010101 AA1  "),
    "?entityPage=3&entitySearch=ABC+010101+AA1",
  );
});

test("limita búsquedas del dominio al contrato de 120 caracteres", () => {
  const oversized = "x".repeat(DOMAIN_SEARCH_MAX_LENGTH + 20);
  assert.equal(normalizeDomainSearch(oversized).length, 120);
  assert.equal(normalizeDomainSearch(null), "");
});

test("un cambio externo de URL reemplaza el draft sin crear otro objeto", () => {
  const draft = { base: "anterior", value: "edición sin aplicar" };
  assert.equal(resolveEntitySearchDraft(draft, "desde-url"), "desde-url");
  assert.equal(
    resolveEntitySearchDraft(
      { base: "desde-url", value: "edición vigente" },
      "desde-url",
    ),
    "edición vigente",
  );
});

test("la recuperación de una entidad inválida vuelve al selector limpio", () => {
  const href = fiscalEntitySelectorHref(
    "/es/organizations/despacho/clients/cliente",
  );
  assert.equal(
    href,
    "/es/organizations/despacho/clients/cliente/fiscal-years",
  );
  assert.equal(href.includes("legal-entities"), false);
  assert.equal(href.includes("?"), false);
});

test("recupera rutas de entidad inexistentes o con UUID inválido", () => {
  const invalidUuid = new ApiError(
    400,
    "Revisa los campos señalados e intenta de nuevo.",
    "VALIDATION_ERROR",
    { legalEntityId: ["Selecciona una opción válida."] },
  );
  assert.equal(
    isLegalEntityRouteUnavailableError(invalidUuid, "uuid-invalido"),
    true,
  );
  assert.equal(
    isLegalEntityRouteUnavailableError(
      new ApiError(404, "No disponible", "LEGAL_ENTITY_NOT_FOUND"),
      "entidad",
    ),
    true,
  );
  assert.equal(
    isLegalEntityRouteUnavailableError(
      new ApiError(400, "Otro campo", "VALIDATION_ERROR", {
        legalEntitySearch: ["Demasiado largo"],
      }),
      "entidad",
    ),
    false,
  );
  assert.equal(isLegalEntityRouteUnavailableError(invalidUuid, undefined), false);
});

test("un deep link consulta el ID exacto sin depender de página o búsqueda", () => {
  assert.deepEqual(legalEntityDetailQuery("entity-id", 8, "otro RFC"), {
    legalEntityId: "entity-id",
    legalEntityPage: 1,
    legalEntityLimit: 1,
  });
  assert.deepEqual(legalEntityDetailQuery(undefined, 8, "RFC"), {
    legalEntityPage: 8,
    legalEntityLimit: 10,
    legalEntitySearch: "RFC",
  });
});
