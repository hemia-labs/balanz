import assert from "node:assert/strict";
import test from "node:test";
import {
  canConfirmLegalDocuments,
  canReuseLegalAcceptance,
} from "./legal-consent";

test("permite continuar cuando todos los documentos requeridos están marcados", () => {
  assert.equal(canConfirmLegalDocuments([], []), false);
  assert.equal(canConfirmLegalDocuments(["version-1"], []), false);
  assert.equal(canConfirmLegalDocuments(["version-1"], ["version-1"]), true);
  assert.equal(canConfirmLegalDocuments(["version-2"], ["version-1"]), false);
});

test("requiere marcar todas las versiones para cualquier cantidad de documentos", () => {
  for (const count of [1, 2, 3, 100]) {
    const versions = Array.from(
      { length: count },
      (_, index) => `version-${index}`,
    );
    assert.equal(canConfirmLegalDocuments(versions, versions), true);
    assert.equal(canConfirmLegalDocuments(versions, versions.slice(1)), false);
  }
});

test("el consentimiento guardado sólo se recupera para los mismos documentos y origen", () => {
  const document = { documentVersionId: "version-1", contentHash: "hash-1" };
  const required = {
    productCode: "balanz_cfdi",
    identitySourceId: "source-1",
    documents: [document],
  };
  const saved = {
    accepted: true,
    productCode: required.productCode,
    identitySourceId: required.identitySourceId,
    legalAcceptanceId: "acceptance-1",
    acceptedDocuments: [document],
  };
  assert.equal(canReuseLegalAcceptance(saved, required), true);
  assert.equal(
    canReuseLegalAcceptance(
      { ...saved, acceptedDocuments: undefined },
      required,
    ),
    false,
  );
  assert.equal(
    canReuseLegalAcceptance(
      { ...saved, identitySourceId: "other-source" },
      required,
    ),
    false,
  );
  assert.equal(
    canReuseLegalAcceptance(saved, {
      ...required,
      documents: [{ ...document, contentHash: "changed" }],
    }),
    false,
  );
  assert.equal(
    canReuseLegalAcceptance(saved, {
      ...required,
      documents: [{ ...document, documentVersionId: "version-2" }],
    }),
    false,
  );
});
