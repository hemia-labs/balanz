import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, apiErrorMessage, classifyApiError, apiClient } from "./api-client";

test("clasifica errores API y evita mensajes sensibles de rate limit", () => {
  assert.equal(classifyApiError(new ApiError(401, "expired")), "unauthenticated");
  assert.equal(classifyApiError(new ApiError(403, "forbidden")), "forbidden");
  assert.equal(classifyApiError(new ApiError(429, "Too many requests")), "rate_limited");
  assert.equal(apiErrorMessage(new ApiError(429, "internal detail"), "fallback"), "Ya realizaste demasiadas solicitudes. Intenta más tarde.");
});

test("normaliza errores de transporte conservando status y código", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "MFA_REQUIRED" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
  try {
    await assert.rejects(apiClient("/auth/session"), (error: unknown) => {
      assert.equal(error instanceof ApiError, true);
      assert.equal((error as ApiError).status, 401);
      assert.equal((error as ApiError).code, "MFA_REQUIRED");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("respeta una señal cancelada antes de iniciar la petición", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.signal?.aborted, true);
    throw new DOMException("Aborted", "AbortError");
  };
  try {
    await assert.rejects(apiClient("/auth/session", { signal: controller.signal }), (error: unknown) => {
      assert.equal(error instanceof ApiError, true);
      assert.equal((error as ApiError).code, "ABORTED");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
