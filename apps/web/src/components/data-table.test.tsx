import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import { DataTable } from "./data-table";
import { FilterBar } from "./filter-bar";
import { CollectionPagination } from "./collection-pagination";
import { StatusBadge } from "./status-badge";
import { ClientRowActions } from "../features/clients/client-row-actions";

const props = {
  caption: "Clientes",
  columns: [{ id: "name", header: "Nombre", wrap: true, render: (row: { id: string; name: string }) => row.name }],
  rows: [{ id: "1", name: "Dato anterior" }],
  rowKey: (row: { id: string }) => row.id,
};

test("acciones de cliente respeta permisos y no ofrece mutaciones para archivados", () => {
  const account = {
    id: "client-test", name: "Cliente de prueba", code: null, version: 1,
    archivedAt: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
  for (const status of ["active", "suspended", "archived"] as const) {
    for (const [canManage, canAssign] of [[false, false], [true, false], [false, true], [true, true]]) {
      let mutations = 0;
      const html = renderToStaticMarkup(<ClientRowActions
        account={{ ...account, status }}
        base="/es/organizations/punto-fiscal"
        canManage={canManage}
        canAssign={canAssign}
        onArchived={() => { mutations += 1; }}
      />);
      assert.ok(html.includes(`/clients/${account.id}/overview`));
      assert.equal(html.includes(`Más acciones de ${account.name}`), status !== "archived" && (canManage || canAssign));
      assert.equal(mutations, 0);
    }
  }
});

test("los estados neutrales y sin período conservan badge, fondo, icono y texto", () => {
  for (const [status, label] of [["not_started", "Sin iniciar"], ["archived", "Archivado"], ["Sin período", "Sin período"]]) {
    const html = renderToStaticMarkup(<StatusBadge status={status} />);
    assert.match(html, /data-slot="badge"/);
    assert.match(html, /data-variant="outline"/);
    assert.match(html, /\bbg-muted\b/);
    assert.match(html, /<svg[^>]*aria-hidden="true"/);
    assert.ok(html.includes(label));
  }
});

test("carga y error conservan encabezados y no exponen filas anteriores", () => {
  for (const state of [{ loading: true }, { error: <p role="alert">No se pudo cargar</p> }]) {
    const html = renderToStaticMarkup(<DataTable {...props} {...state} />);
    assert.match(html, /scope="col"[^>]*>Nombre/);
    assert.doesNotMatch(html, /Dato anterior/);
    assert.match(html, state.loading ? /aria-busy="true"/ : /role="alert"/);
  }
});

test("vacío y ajuste de texto respetan el contenido configurado", () => {
  const empty = renderToStaticMarkup(<DataTable {...props} rows={[]} emptyMessage="Sin coincidencias" />);
  assert.match(empty, /colSpan="1"|colspan="1"/);
  assert.match(empty, /Sin coincidencias/);
  assert.match(renderToStaticMarkup(<DataTable {...props} />), /whitespace-normal break-words/);
});

test("paginación conserva rango y límites, incluso tras desaparecer la última página", () => {
  for (const page of [1, 3, 4]) {
    const html = renderToStaticMarkup(<CollectionPagination meta={{ page, limit: 10, total: 25, totalPages: 3 }} itemLabel="clientes" onPageChange={() => {}} />);
    assert.match(html, new RegExp(`${page === 1 ? 1 : page === 3 ? 21 : 25}–${page === 1 ? 10 : 25} de 25 clientes`));
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    assert.equal(buttons.length, 2);
    assert.equal(/\sdisabled(?:=|\s|>)/.test(buttons[0]), page === 1);
    assert.equal(/\sdisabled(?:=|\s|>)/.test(buttons[1]), page >= 3);
    assert.doesNotMatch(html, /href="#"/);
  }
  const html = renderToStaticMarkup(<CollectionPagination meta={{ page: 1, limit: 10, total: 0, totalPages: 0 }} itemLabel="clientes" onPageChange={() => {}} />);
  assert.match(html, /0–0 de 0 clientes/);
  assert.doesNotMatch(html, /<button/);
});

test("FilterBar mantiene composición fija y oculta capacidades ausentes", () => {
  const html = renderToStaticMarkup(<FilterBar
    search={{ label: "Buscar registros", placeholder: "Buscar", value: "", onChange: () => {} }}
    filters={[{ id: "state", label: "Estado", value: "active", defaultValue: "", options: [{ value: "", label: "Todos" }, { value: "active", label: "Activo" }], onChange: () => {} }]}
    sort={{ value: "name", options: [{ value: "name", label: "Nombre" }], onChange: () => {} }}
    canClear
    onClear={() => {}}
  />);
  assert.ok(html.indexOf("Buscar registros") < html.indexOf(">Filtros"));
  assert.ok(html.indexOf(">Filtros") < html.indexOf("Ordenar"));
  assert.doesNotMatch(html, /Quitar filtro|Estado: Activo/);
  assert.match(html, /aria-label="Filtros: 1 activos"/);
  assert.match(html, /group\/badge/);
  assert.match(html, /Limpiar búsqueda y filtros/);
  const empty = renderToStaticMarkup(<FilterBar canClear={false} onClear={() => {}} />);
  assert.doesNotMatch(empty, /<button|<input/);
});

test("FilterBar sólo cuenta criterios distintos del valor inicial", () => {
  const html = renderToStaticMarkup(<FilterBar
    filters={[{ id: "state", label: "Estado", value: "active", defaultValue: "active", options: [{ value: "active", label: "Activo" }], onChange: () => {} }]}
    canClear={false}
    onClear={() => {}}
  />);
  assert.match(html, /Filtros/);
  assert.doesNotMatch(html, /Filtros \(1\)|Quitar filtro|Limpiar filtros|Ordenar/);
});

test("ordenamiento anuncia dirección y comunica el siguiente criterio sin reordenar filas", () => {
  const columns = props.columns.map((column) => ({ ...column, sortKey: "name" }));
  for (const [key, direction, next] of [["name", "asc", "desc"], ["name", "desc", "asc"], ["updatedAt", "desc", "asc"]] as const) {
    const changes: unknown[] = [];
    const config = { ...props, columns, sorting: { key, direction, onChange: (key: string, direction: "asc" | "desc") => changes.push([key, direction]) } };
    const html = renderToStaticMarkup(<DataTable {...config} />);
    if (key === "name") {
      assert.match(html, new RegExp(`aria-sort="${direction === "asc" ? "ascending" : "descending"}"`));
    } else {
      assert.doesNotMatch(html, /aria-sort=/);
    }
    assert.match(html, /Dato anterior/);
    const table = DataTable(config);
    const headerButton = table.props.children[1].props.children.props.children[0].props.children;
    headerButton.props.onClick();
    assert.deepEqual(changes, [["name", next]]);
  }
});

test("alineación final se aplica al encabezado y celda sin convertir acciones en números", () => {
  const html = renderToStaticMarkup(<DataTable {...props} columns={[
    ...props.columns,
    { id: "action", header: "Acciones", align: "end", render: () => <Link href="/clientes/1">Ver detalle</Link> },
    { id: "amount", header: "Importe", numeric: true, render: () => "100.00" },
  ]} />);
  assert.match(html, /<th\b[^>]*class="[^"]*text-right[^"]*"[^>]*>Acciones/);
  assert.match(html, /<td\b[^>]*class="[^"]*text-right[^"]*"[^>]*><a/);
  assert.equal((html.match(/\bnumeric\b(?=")/g) ?? []).length, 2);
});
