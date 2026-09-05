import assert from "node:assert/strict";
import test from "node:test";
import {
  transferProgress,
  XML_MAX_BYTES,
  validateXmlSelection,
} from "./upload-validation";

test("calcula progreso sólo con el total real reportado por XHR", () => {
  assert.deepEqual(transferProgress(50, 100, true), {
    loaded: 50,
    total: 100,
    percent: 50,
  });
  assert.deepEqual(transferProgress(50, 0, false), {
    loaded: 50,
    total: 0,
    percent: 0,
  });
});

test("acepta exactamente un XML de hasta 5 MiB", () => {
  assert.equal(validateXmlSelection([{ name: "factura.XML", size: 128 }]), null);
  assert.equal(
    validateXmlSelection([{ name: "limite.xml", size: XML_MAX_BYTES }]),
    null,
  );
});

test("rechaza ausencia, selección múltiple, extensión y exceso", () => {
  assert.equal(validateXmlSelection([]), "missing");
  assert.equal(
    validateXmlSelection([
      { name: "a.xml", size: 1 },
      { name: "b.xml", size: 1 },
    ]),
    "multiple",
  );
  assert.equal(validateXmlSelection([{ name: "a.zip", size: 1 }]), "extension");
  assert.equal(
    validateXmlSelection([{ name: "a.xml", size: XML_MAX_BYTES + 1 }]),
    "size",
  );
});
