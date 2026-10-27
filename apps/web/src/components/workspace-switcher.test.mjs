import assert from "node:assert/strict";
import { mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let switches = 0;
mock.module("./accounting-context", () => ({
  useAccountingContext: () => ({
    organization: { id: "one", name: "Punto Fiscal" },
    organizations: [{ id: "one", name: "Punto Fiscal", slug: "punto-fiscal" }],
    changeOrganization: async () => { switches += 1; },
  }),
}));
const { WorkspaceSwitcher } = await import("./workspace-switcher");

test("el selector colapsado conserva un botón de menú accesible con avatar", () => {
  for (const compact of [true, false]) {
    const html = renderToStaticMarkup(createElement(WorkspaceSwitcher, { compact }));
    assert.match(html, /<button/);
    assert.match(html, /aria-haspopup="menu"/);
    assert.match(html, /aria-label="Cambiar espacio de trabajo: Punto Fiscal"/);
    assert.match(html, /data-slot="avatar-fallback"[^>]*>PF</);
    assert.equal(html.includes("Espacio de trabajo</span>"), !compact);
    assert.equal(html.includes("lucide-chevrons-up-down"), !compact);
  }
  assert.equal(switches, 0, "renderizar no debe cambiar el tenant");
});
