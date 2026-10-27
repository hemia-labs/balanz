import assert from "node:assert/strict";
import { mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({ usePathname: () => "/es/organizations/punto-fiscal/home" }));
mock.module("./accounting-context", () => ({
  useAccountingContext: () => ({ organization: { id: "one", slug: "punto-fiscal" }, clients: [] }),
}));
const { ContextSearch } = await import("./context-search");

test("la búsqueda es un input inline con atajo; colapsada ofrece un botón sin modal", () => {
  let expansions = 0;
  for (const compact of [false, true]) {
    const html = renderToStaticMarkup(createElement(ContextSearch, { compact, onExpand: () => { expansions += 1; } }));
    assert.equal(html.includes("<dialog"), false);
    assert.equal(html.includes('type="search"'), !compact);
    if (compact) {
      assert.match(html, /<button/);
      assert.match(html, /aria-label="Buscar clientes"/);
    } else {
      assert.match(html, /aria-keyshortcuts="Meta\+K Control\+K"/);
      assert.match(html, /Buscar clientes por nombre o RFC/);
      assert.match(html, /<kbd/);
    }
  }
  assert.equal(expansions, 0);
});
