const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

export type FieldErrors = Record<string, string[]>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly fieldErrors: FieldErrors = {},
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAbortError(error: unknown) {
  return isApiError(error) && error.code === "ABORTED";
}

export type ApiErrorKind = "unauthenticated" | "forbidden" | "conflict" | "validation" | "rate_limited" | "network" | "unknown";

export function classifyApiError(error: unknown): ApiErrorKind {
  if (!isApiError(error)) return "unknown";
  if (error.code === "NETWORK_ERROR" || error.code === "TIMEOUT") return "network";
  if (error.status === 401 || error.code === "MFA_REQUIRED") return "unauthenticated";
  if (error.status === 403 || error.code === "MFA_SETUP_REQUIRED") return "forbidden";
  if (error.status === 409) return "conflict";
  if (error.status === 422) return "validation";
  if (error.status === 429) return "rate_limited";
  return "unknown";
}

export function apiErrorMessage(error: unknown, fallback: string) {
  if (!isApiError(error)) return fallback;
  if (error.code === "MFA_REQUIRED") return "Completa la verificación MFA para continuar.";
  if (error.code === "MFA_SETUP_REQUIRED") return "Configura MFA en Seguridad para realizar esta acción.";
  if (error.code === "MFA_INVALID_CODE") return "El código MFA no es válido o ha expirado.";
  if (error.status === 429) return "Ya realizaste demasiadas solicitudes. Intenta más tarde.";
  return error.message || fallback;
}

function normalizeFieldErrors(value: unknown): FieldErrors {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([field, messages]) => {
      if (Array.isArray(messages)) return [[field, messages.map(String)]];
      if (typeof messages === "string") return [[field, [messages]]];
      return [];
    }),
  );
}

function errorCode(message: unknown, code: unknown) {
  if (typeof code === "string" && code) return code;
  return typeof message === "string" && /^[A-Z0-9_]+$/.test(message) ? message : undefined;
}

export async function apiClient<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const externalSignal = init.signal;
  const abort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("json") ? await response.json().catch(() => null) : null;
    if (!response.ok) {
      const message = Array.isArray(body?.message) ? body.message.join(". ") : body?.message;
      throw new ApiError(
        response.status,
        message ?? body?.error ?? "No se pudo completar la operación",
        errorCode(message, body?.code),
        normalizeFieldErrors(body?.fieldErrors ?? body?.errors),
        body?.details,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(0, "La solicitud fue cancelada o tardó demasiado.", externalSignal?.aborted ? "ABORTED" : "TIMEOUT");
    }
    throw new ApiError(0, "No se pudo conectar con el servicio.", "NETWORK_ERROR", {}, error);
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}
