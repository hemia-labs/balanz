import assert from "node:assert/strict";
import test from "node:test";
import {
  abortPendingApiRequests,
  ApiError,
  apiErrorMessage,
  classifyApiError,
  apiClient,
  apiClientResponse,
  apiResourceUrl,
  registerPendingApiAbort,
  shouldNotifyUnauthorizedApi,
  subscribeToUnauthorizedApi,
} from "./api-client";

test("aborta transports XHR registrados antes de cambiar de tenant", () => {
  let aborts = 0;
  const unregister = registerPendingApiAbort(() => {
    aborts += 1;
  });

  try {
    abortPendingApiRequests();
    assert.equal(aborts, 1);
  } finally {
    unregister();
  }

  abortPendingApiRequests();
  assert.equal(aborts, 1);
});

test("resuelve descargas temporales únicamente en el origen de la API", () => {
  assert.equal(
    apiResourceUrl("/api/v1/cfdis/cfdi/content?token=one-time"),
    "http://localhost:3021/api/v1/cfdis/cfdi/content?token=one-time",
  );
  assert.throws(
    () => apiResourceUrl("https://example.invalid/steal-token"),
    (error: unknown) =>
      error instanceof ApiError && error.code === "INVALID_API_RESPONSE",
  );
});

test("clasifica errores API y evita mensajes sensibles de rate limit", () => {
  assert.equal(
    classifyApiError(new ApiError(401, "expired")),
    "unauthenticated",
  );
  assert.equal(classifyApiError(new ApiError(403, "forbidden")), "forbidden");
  assert.equal(
    classifyApiError(new ApiError(401, "MFA_REQUIRED", "MFA_REQUIRED")),
    "mfa_required",
  );
  assert.equal(
    classifyApiError(
      new ApiError(
        401,
        "REAUTHENTICATION_REQUIRED",
        "REAUTHENTICATION_REQUIRED",
      ),
    ),
    "reauthentication_required",
  );
  assert.equal(
    classifyApiError(new ApiError(404, "OUT_OF_SCOPE", "OUT_OF_SCOPE")),
    "out_of_scope",
  );
  assert.equal(
    classifyApiError(new ApiError(429, "Too many requests")),
    "rate_limited",
  );
  assert.equal(
    classifyApiError(new ApiError(400, "Invalid", "VALIDATION_ERROR")),
    "validation",
  );
  assert.equal(
    apiErrorMessage(new ApiError(429, "internal detail"), "fallback"),
    "Ya realizaste demasiadas solicitudes. Intenta más tarde.",
  );
  assert.equal(
    apiErrorMessage(
      new ApiError(400, "Invalid", "MFA_INVALID_CODE"),
      "fallback",
    ),
    "El código MFA no es válido o ha expirado.",
  );
  assert.equal(
    apiErrorMessage(
      new ApiError(400, "technical detail", "VALIDATION_ERROR", {
        "legalEntity.rfc": ["Ingresa un RFC válido."],
      }),
      "fallback",
    ),
    "Revisa los campos señalados e intenta de nuevo.",
  );
  assert.equal(
    apiErrorMessage(
      new ApiError(400, "rfc must match a regular expression"),
      "No se pudo guardar.",
    ),
    "No se pudo guardar.",
  );
  assert.equal(
    apiErrorMessage(new ApiError(500, "database detail"), "fallback"),
    "Ocurrió un error inesperado. Intenta nuevamente.",
  );
});

test("expone ETag y Retry-After y acepta 304 para polling", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, {
      status: 304,
      headers: { etag: '"job-v3"', "retry-after": "2" },
    });
  try {
    const response = await apiClientResponse("/ingestions/job", {
      headers: { "If-None-Match": '"job-v2"' },
    });
    assert.equal(response.status, 304);
    assert.equal(response.headers.get("etag"), '"job-v3"');
    assert.equal(response.headers.get("retry-after"), "2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normaliza errores de transporte conservando status y código", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "MFA_REQUIRED" }), {
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

test("notifica globalmente un 401 de una operación autenticada", async () => {
  const originalFetch = globalThis.fetch;
  const events: Array<{ status: number; method: string; path: string }> = [];
  const unsubscribe = subscribeToUnauthorizedApi(({ error, method, path }) => {
    events.push({ status: error.status, method, path });
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "SESSION_EXPIRED" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

  try {
    await assert.rejects(
      apiClient("/client-accounts?page=2", { method: "post" }),
      (error: unknown) => error instanceof ApiError && error.status === 401,
    );
    assert.deepEqual(events, [
      { status: 401, method: "POST", path: "/client-accounts?page=2" },
    ]);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
  }
});

test("mantiene locales los 401 de bootstrap/login y propaga logout expirado", async () => {
  const originalFetch = globalThis.fetch;
  let notifications = 0;
  const unsubscribe = subscribeToUnauthorizedApi(() => {
    notifications += 1;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "UNAUTHORIZED" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

  try {
    for (const path of [
      "/auth/session",
      "/auth/session/?source=bootstrap",
      "/auth/login",
      "/auth/login/mfa",
    ]) {
      await assert.rejects(apiClient(path), ApiError);
    }
    assert.equal(notifications, 0);
    await assert.rejects(
      apiClient("/auth/session", { method: "DELETE" }),
      ApiError,
    );
    assert.equal(notifications, 1);
    assert.equal(shouldNotifyUnauthorizedApi("/auth/session", "GET"), false);
    assert.equal(shouldNotifyUnauthorizedApi("/auth/session", "DELETE"), true);
    assert.equal(shouldNotifyUnauthorizedApi("/auth/session/organization"), true);
    assert.equal(shouldNotifyUnauthorizedApi("/me/authorization"), true);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
  }
});

test("un listener defectuoso no reemplaza el ApiError original", async () => {
  const originalFetch = globalThis.fetch;
  const unsubscribe = subscribeToUnauthorizedApi(() => {
    throw new Error("listener failure");
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "SESSION_EXPIRED" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

  try {
    await assert.rejects(apiClient("/client-accounts"), (error: unknown) => {
      assert.equal(error instanceof ApiError, true);
      assert.equal((error as ApiError).status, 401);
      assert.equal((error as ApiError).code, "SESSION_EXPIRED");
      return true;
    });
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
  }
});

test("respeta una señal cancelada antes de iniciar la petición", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let notifications = 0;
  const unsubscribe = subscribeToUnauthorizedApi(() => {
    notifications += 1;
  });
  controller.abort();
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.signal?.aborted, true);
    throw new DOMException("Aborted", "AbortError");
  };
  try {
    await assert.rejects(
      apiClient("/auth/session", { signal: controller.signal }),
      (error: unknown) => {
        assert.equal(error instanceof ApiError, true);
        assert.equal((error as ApiError).code, "ABORTED");
        return true;
      },
    );
    assert.equal(notifications, 0);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
  }
});
