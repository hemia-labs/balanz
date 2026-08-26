import assert from "node:assert/strict";
import test from "node:test";
import {
  localeFromPath,
  unauthorizedLoginDestination,
} from "./unauthorized-navigation";

test("conserva la ruta interna y sus filtros como returnTo", () => {
  assert.equal(
    unauthorizedLoginDestination(
      "/es/organizaciones/acme/clientes",
      "page=3&search=uno",
    ),
    "/es/login?returnTo=%2Fes%2Forganizaciones%2Facme%2Fclientes%3Fpage%3D3%26search%3Duno",
  );
});

test("evita redirecciones abiertas y usa un locale conocido", () => {
  assert.equal(localeFromPath("/en/private"), "es");
  assert.equal(
    unauthorizedLoginDestination("//attacker.example/private", "token=secret"),
    "/es/login?returnTo=%2F",
  );
  assert.equal(
    unauthorizedLoginDestination("/\\attacker.example/private"),
    "/es/login?returnTo=%2F",
  );
});

test("no genera otra navegación cuando ya está en login", () => {
  assert.equal(unauthorizedLoginDestination("/es/login", "returnTo=%2F"), null);
  assert.equal(unauthorizedLoginDestination("/es/login/"), null);
});
