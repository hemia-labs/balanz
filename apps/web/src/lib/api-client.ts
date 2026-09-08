const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3021/api/v1";
const DEFAULT_TIMEOUT_MS = 10_000;
const activeApiRequests = new Set<AbortController>();
const activeExternalAborts = new Set<() => void>();

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

export interface UnauthorizedApiEvent {
  error: ApiError;
  method: string;
  path: string;
}

type UnauthorizedApiListener = (event: UnauthorizedApiEvent) => void;

const unauthorizedApiListeners = new Set<UnauthorizedApiListener>();

/**
 * Allows the authenticated application shell to react to an expired session
 * regardless of which feature made the request. Authentication bootstrap and
 * login requests deliberately remain local to their own flows.
 */
export function subscribeToUnauthorizedApi(listener: UnauthorizedApiListener) {
  unauthorizedApiListeners.add(listener);
  return () => {
    unauthorizedApiListeners.delete(listener);
  };
}

function pathnameForApiRequest(path: string) {
  try {
    return new URL(path, "https://api.balanz.invalid").pathname.replace(
      /\/$/,
      "",
    );
  } catch {
    return path.split(/[?#]/, 1)[0].replace(/\/$/, "");
  }
}

export function shouldNotifyUnauthorizedApi(path: string, method = "GET") {
  const pathname = pathnameForApiRequest(path);
  const requestMethod = method.toUpperCase();
  return (
    !(pathname === "/auth/session" && requestMethod === "GET") &&
    pathname !== "/auth/login" &&
    !pathname.startsWith("/auth/login/")
  );
}

function notifyUnauthorizedApi(event: UnauthorizedApiEvent) {
  for (const listener of [...unauthorizedApiListeners]) {
    try {
      listener(event);
    } catch {
      // A UI listener must never replace the original API error.
    }
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAbortError(error: unknown) {
  return isApiError(error) && error.code === "ABORTED";
}

export function abortPendingApiRequests() {
  for (const controller of [...activeApiRequests]) controller.abort();
  for (const abort of [...activeExternalAborts]) abort();
}

/** Registers transports that cannot share fetch's AbortController (XHR uploads). */
export function registerPendingApiAbort(abort: () => void) {
  activeExternalAborts.add(abort);
  return () => {
    activeExternalAborts.delete(abort);
  };
}

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

/**
 * Resolves a server-issued resource path against the configured API origin.
 * Temporary download URLs must remain on that origin so an unexpected API
 * response cannot navigate the browser (and its one-time token) elsewhere.
 */
export function apiResourceUrl(path: string) {
  try {
    const apiBase = new URL(API_BASE);
    const resolved = new URL(path, `${apiBase.origin}/`);
    if (
      !path.startsWith("/") ||
      resolved.origin !== apiBase.origin ||
      !["http:", "https:"].includes(resolved.protocol)
    ) {
      throw new Error("untrusted API resource URL");
    }
    return resolved.toString();
  } catch {
    throw new ApiError(
      502,
      "La API devolvió una dirección de descarga no válida.",
      "INVALID_API_RESPONSE",
    );
  }
}

const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  ACCOUNT_ASSIGNMENT_CONFLICT:
    "Este integrante ya tiene una asignación activa en la cuenta.",
  ACCOUNT_ASSIGNMENT_NOT_FOUND: "La asignación ya no está disponible.",
  ACTIVE_TENANT_REQUIRED: "Selecciona una organización activa para continuar.",
  ARCHIVED_ACCESS_FORBIDDEN:
    "No tienes permiso para consultar elementos archivados.",
  CLIENT_ACCOUNT_CODE_CONFLICT: "Ya existe un cliente activo con este código.",
  CLIENT_ACCOUNT_NOT_FOUND: "El cliente no existe o ya no tienes acceso.",
  FISCAL_YEAR_CONFLICT:
    "Este ejercicio fiscal ya existe para la entidad seleccionada.",
  FISCAL_YEAR_NOT_FOUND: "El ejercicio fiscal ya no está disponible.",
  INVALID_CLIENT_SORT: "El orden seleccionado no es válido.",
  INVALID_FISCAL_YEAR: "Selecciona un ejercicio entre 2000 y el próximo año.",
  LAST_ACTIVE_LEGAL_ENTITY:
    "No puedes archivar el último RFC activo del cliente.",
  LAST_PRIMARY_ASSIGNMENT:
    "Asigna primero un nuevo responsable principal antes de retirar el actual.",
  LEGAL_ENTITY_NOT_FOUND: "La entidad fiscal no existe o ya no tienes acceso.",
  LEGAL_ENTITY_RFC_CONFLICT:
    "Este RFC ya está activo dentro de la organización.",
  MEMBERSHIP_NOT_ELIGIBLE:
    "El integrante seleccionado no puede ser responsable principal.",
  PRIMARY_ASSIGNMENT_CONFLICT:
    "La cuenta ya tiene un responsable principal activo.",
  STALE_CLIENT_ACCOUNT:
    "La cuenta cambió mientras la editabas. Recarga e intenta de nuevo.",
  STALE_LEGAL_ENTITY:
    "La entidad fiscal cambió mientras la editabas. Recarga e intenta de nuevo.",
  VALIDATION_ERROR: "Revisa los campos señalados e intenta de nuevo.",
  INSUFFICIENT_PERMISSION: "No tienes permiso para realizar esta acción.",
  PERMISSION_DENIED: "No tienes permiso para realizar esta acción.",
  OUT_OF_SCOPE: "El recurso no está dentro de tus cuentas asignadas.",
  IDEMPOTENCY_CONFLICT:
    "La clave de idempotencia ya fue usada para un archivo diferente.",
  XML_FILE_REQUIRED: "Selecciona exactamente un archivo XML.",
  XML_FILE_TOO_LARGE: "El XML supera el límite permitido de 5 MiB.",
  XML_MIME_MISMATCH: "El contenido del archivo no corresponde a un XML.",
  INGESTION_NOT_FOUND: "El proceso no existe o ya no tienes acceso.",
  CFDI_NOT_FOUND: "El CFDI no existe o ya no tienes acceso.",
  REAUTHENTICATION_REQUIRED:
    "Vuelve a autenticarte para confirmar esta acción sensible.",
};

export type ApiErrorKind =
  | "unauthenticated"
  | "mfa_required"
  | "reauthentication_required"
  | "out_of_scope"
  | "forbidden"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "network"
  | "unknown";

export function classifyApiError(error: unknown): ApiErrorKind {
  if (!isApiError(error)) return "unknown";
  if (error.code === "NETWORK_ERROR" || error.code === "TIMEOUT")
    return "network";
  if (error.code === "VALIDATION_ERROR") return "validation";
  if (error.code === "MFA_REQUIRED" || error.code === "MFA_SETUP_REQUIRED")
    return "mfa_required";
  if (error.code === "REAUTHENTICATION_REQUIRED")
    return "reauthentication_required";
  if (error.code === "OUT_OF_SCOPE" || error.code === "RESOURCE_NOT_FOUND")
    return "out_of_scope";
  if (error.status === 401) return "unauthenticated";
  if (error.status === 403) return "forbidden";
  if (error.status === 409) return "conflict";
  if (error.status === 422) return "validation";
  if (error.status === 429) return "rate_limited";
  return "unknown";
}

export function apiErrorMessage(error: unknown, fallback: string) {
  if (!isApiError(error)) return fallback;
  if (error.code && FRIENDLY_ERROR_MESSAGES[error.code])
    return FRIENDLY_ERROR_MESSAGES[error.code];
  if (error.code === "MFA_REQUIRED")
    return "Completa la verificación MFA para continuar.";
  if (error.code === "MFA_SETUP_REQUIRED")
    return "Configura MFA en Seguridad para realizar esta acción.";
  if (error.code === "MFA_INVALID_CODE")
    return "El código MFA no es válido o ha expirado.";
  if (error.status === 429)
    return "Ya realizaste demasiadas solicitudes. Intenta más tarde.";
  if (error.status >= 500)
    return "Ocurrió un error inesperado. Intenta nuevamente.";
  if (
    /regular expression|\bmust be\b|should not exist|internal server error/i.test(
      error.message,
    )
  )
    return fallback;
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
  return typeof message === "string" && /^[A-Z0-9_]+$/.test(message)
    ? message
    : undefined;
}

export function apiErrorFromPayload(
  status: number,
  payload: unknown,
  fallback = "No se pudo completar la operación",
) {
  const body =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const rawMessage = body.message;
  const message = Array.isArray(rawMessage)
    ? rawMessage.map(String).join(". ")
    : typeof rawMessage === "string"
      ? rawMessage
      : typeof body.error === "string"
        ? body.error
        : fallback;
  return new ApiError(
    status,
    message,
    errorCode(rawMessage, body.code),
    normalizeFieldErrors(body.fieldErrors ?? body.errors),
    body.details,
  );
}

export function reportApiUnauthorized(
  error: ApiError,
  path: string,
  method = "GET",
) {
  const requestMethod = method.toUpperCase();
  if (
    error.status === 401 &&
    error.code !== "MFA_REQUIRED" &&
    error.code !== "REAUTHENTICATION_REQUIRED" &&
    shouldNotifyUnauthorizedApi(path, requestMethod)
  ) {
    notifyUnauthorizedApi({ error, method: requestMethod, path });
  }
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export async function apiClientResponse<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  activeApiRequests.add(controller);
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    DEFAULT_TIMEOUT_MS,
  );
  const externalSignal = init.signal;
  const abort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      credentials: "include",
      headers,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("json")
      ? await response.json().catch(() => null)
      : null;
    if (!response.ok && response.status !== 304) {
      const requestError = apiErrorFromPayload(response.status, body);
      reportApiUnauthorized(requestError, path, init.method ?? "GET");
      throw requestError;
    }
    return { data: body as T, status: response.status, headers: response.headers };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(
        0,
        "La solicitud fue cancelada o tardó demasiado.",
        externalSignal?.aborted ? "ABORTED" : "TIMEOUT",
      );
    }
    throw new ApiError(
      0,
      "No se pudo conectar con el servicio.",
      "NETWORK_ERROR",
      {},
      error,
    );
  } finally {
    activeApiRequests.delete(controller);
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}

export async function apiClient<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return (await apiClientResponse<T>(path, init)).data;
}
