"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  abortPendingApiRequests,
  ApiError,
  isAbortError,
  subscribeToUnauthorizedApi,
} from "@/lib/api-client";
import { selectOrganization } from "@/features/organizations/api";
import { getAuthorization, getSession } from "@/features/session/api";
import { getOrganizations } from "@/features/organizations/api";
import {
  localeFromPath,
  unauthorizedLoginDestination,
} from "./unauthorized-navigation";
import type {
  AuthorizationContext,
  OrganizationSummary,
  SessionContext,
  SessionState,
} from "./types";

interface SessionContextValue {
  status: SessionState;
  session: SessionContext | null;
  authorization: AuthorizationContext | null;
  organizations: OrganizationSummary[];
  error: ApiError | null;
  refreshSession: () => Promise<void>;
  refreshAuthorization: () => Promise<void>;
  switchTenant: (organizationId: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function statusForError(error: ApiError): SessionState {
  if (
    error.code === "MFA_REQUIRED" ||
    error.code === "MFA_SETUP_REQUIRED" ||
    error.status === 403
  )
    return "forbidden";
  if (error.status === 401) return "unauthenticated";
  return "error";
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const router = useRouter();
  const navigationRef = useRef({ pathname, search });
  const requestVersion = useRef(0);
  const redirectingUnauthorized = useRef(false);
  const [status, setStatus] = useState<SessionState>("checking");
  const [session, setSession] = useState<SessionContext | null>(null);
  const [authorization, setAuthorization] =
    useState<AuthorizationContext | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    navigationRef.current = { pathname, search };
  }, [pathname, search]);

  const invalidateSession = useCallback(
    (requestError: ApiError) => {
      requestVersion.current += 1;
      setSession(null);
      setAuthorization(null);
      setOrganizations([]);
      setError(requestError);
      setStatus("unauthenticated");

      if (redirectingUnauthorized.current) return;
      const current = navigationRef.current;
      const destination = unauthorizedLoginDestination(
        current.pathname,
        current.search,
      );
      if (!destination) return;
      redirectingUnauthorized.current = true;
      router.replace(destination);
    },
    [router],
  );

  useEffect(
    () =>
      subscribeToUnauthorizedApi(({ error: requestError }) => {
        invalidateSession(requestError);
      }),
    [invalidateSession],
  );

  const loadSession = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current;
      setStatus("checking");
      setError(null);
      try {
        const current = await getSession(signal);
        const available = await getOrganizations(signal);
        if (version !== requestVersion.current) return;
        setSession(current);
        setOrganizations(available);
        if (!current.tenantActive || !current.organizationId) {
          setAuthorization(null);
          setStatus("tenant_required");
          router.replace(
            `/${localeFromPath(navigationRef.current.pathname)}/select-organization`,
          );
          return;
        }
        const permissions = await getAuthorization(signal);
        if (version !== requestVersion.current) return;
        setAuthorization(permissions);
        setStatus("authenticated");
      } catch (cause) {
        if (version !== requestVersion.current || isAbortError(cause)) return;
        const requestError =
          cause instanceof ApiError
            ? cause
            : new ApiError(
                0,
                "No se pudo validar la sesión.",
                "SESSION_ERROR",
                {},
                cause,
              );
        if (requestError.status === 401) {
          invalidateSession(requestError);
          return;
        }
        setSession(null);
        setAuthorization(null);
        setOrganizations([]);
        setError(requestError);
        const nextStatus = statusForError(requestError);
        setStatus(nextStatus);
      }
    },
    [invalidateSession, router],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      void loadSession(controller.signal);
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
      requestVersion.current += 1;
    };
  }, [loadSession]);

  const switchTenant = useCallback(
    async (organizationId: string) => {
      abortPendingApiRequests();
      requestVersion.current += 1;
      setStatus("switching_tenant");
      setError(null);
      setSession(null);
      setAuthorization(null);
      try {
        await selectOrganization(organizationId);
        await loadSession();
      } catch (cause) {
        const requestError =
          cause instanceof ApiError
            ? cause
            : new ApiError(
                0,
                "No se pudo activar la organización.",
                "TENANT_SWITCH_ERROR",
                {},
                cause,
              );
        if (
          requestError.status === 401 &&
          requestError.code !== "MFA_REQUIRED" &&
          requestError.code !== "REAUTHENTICATION_REQUIRED"
        )
          invalidateSession(requestError);
        else {
          setError(requestError);
          setStatus(statusForError(requestError));
        }
        throw requestError;
      }
    },
    [invalidateSession, loadSession],
  );

  const refreshAuthorization = useCallback(async () => {
    const permissions = await getAuthorization();
    if (permissions.organizationId === session?.organizationId) {
      setAuthorization(permissions);
    }
  }, [session?.organizationId]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.organizationId) return;
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void getAuthorization()
        .then((next) => {
          if (active && next.organizationId === session.organizationId) {
            setAuthorization(next);
          }
        })
        .catch((cause) => {
          // Authentication failures are handled globally by apiClient. A
          // revoked membership must fail closed; transient failures retain the
          // last valid context so navigation does not flicker.
          if (active && cause instanceof ApiError && cause.status === 403) {
            setAuthorization(null);
            setError(cause);
            setStatus("forbidden");
          }
        });
    };
    const onVisibilityChange = () => refresh();
    const timer = globalThis.setInterval(refresh, 30_000);
    globalThis.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      globalThis.clearInterval(timer);
      globalThis.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [session?.organizationId, status]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      session,
      authorization,
      organizations,
      error,
      refreshSession: async () => loadSession(),
      refreshAuthorization,
      switchTenant,
    }),
    [
      authorization,
      error,
      loadSession,
      organizations,
      refreshAuthorization,
      session,
      status,
      switchTenant,
    ],
  );

  if (
    status === "checking" ||
    status === "switching_tenant" ||
    status === "tenant_required"
  ) {
    return (
      <div className="grid min-h-screen place-items-center text-body-sm text-muted-foreground">
        Validando sesión…
      </div>
    );
  }
  if (status === "unauthenticated") return null;
  if (status === "forbidden") {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="max-w-form space-y-4 text-center">
          <p
            role="alert"
            aria-live="polite"
            className="text-body-sm text-destructive"
          >
            {error?.message ?? "No tienes acceso a este contexto."}
          </p>
          <Link
            href={`/${localeFromPath(pathname)}/login`}
            className="font-semibold text-primary underline"
          >
            Volver a iniciar sesión
          </Link>
        </div>
      </main>
    );
  }
  if (status === "error") {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="max-w-form space-y-4 text-center">
          <p
            role="alert"
            aria-live="polite"
            className="text-body-sm text-destructive"
          >
            {error?.message ?? "No se pudo validar la sesión."}
          </p>
          <button
            type="button"
            onClick={() => void loadSession()}
            className="font-semibold text-primary underline"
          >
            Reintentar
          </button>
        </div>
      </main>
    );
  }
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value)
    throw new Error("useSession debe usarse dentro de SessionProvider");
  return value;
}
