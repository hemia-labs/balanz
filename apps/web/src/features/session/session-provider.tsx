"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ApiError, isAbortError } from "@/lib/api-client";
import { selectOrganization } from "@/features/organizations/api";
import { getAuthorization, getSession } from "@/features/session/api";
import { getOrganizations } from "@/features/organizations/api";
import type { AuthorizationContext, OrganizationSummary, SessionContext, SessionState } from "./types";

interface SessionContextValue {
  status: SessionState;
  session: SessionContext | null;
  authorization: AuthorizationContext | null;
  organizations: OrganizationSummary[];
  error: ApiError | null;
  refreshSession: () => Promise<void>;
  switchTenant: (organizationId: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function localeFromPath(pathname: string) {
  return pathname.split("/").filter(Boolean)[0] ?? "es";
}

function safeReturnTo(pathname: string, search: string) {
  const value = `${pathname}${search}`;
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function statusForError(error: ApiError): SessionState {
  if (error.code === "MFA_REQUIRED" || error.code === "MFA_SETUP_REQUIRED" || error.status === 403) return "forbidden";
  if (error.status === 401) return "unauthenticated";
  return "error";
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestVersion = useRef(0);
  const [status, setStatus] = useState<SessionState>("checking");
  const [session, setSession] = useState<SessionContext | null>(null);
  const [authorization, setAuthorization] = useState<AuthorizationContext | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const loadSession = useCallback(async (signal?: AbortSignal) => {
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
        router.replace(`/${localeFromPath(pathname)}/select-organization`);
        return;
      }
      const permissions = await getAuthorization(signal);
      if (version !== requestVersion.current) return;
      setAuthorization(permissions);
      setStatus("authenticated");
    } catch (cause) {
      if (version !== requestVersion.current || isAbortError(cause)) return;
      const requestError = cause instanceof ApiError
        ? cause
        : new ApiError(0, "No se pudo validar la sesión.", "SESSION_ERROR", {}, cause);
      setSession(null);
      setAuthorization(null);
      setError(requestError);
      const nextStatus = statusForError(requestError);
      setStatus(nextStatus);
      if (nextStatus === "unauthenticated") {
        const returnTo = safeReturnTo(pathname, searchParams.toString() ? `?${searchParams.toString()}` : "");
        router.replace(`/${localeFromPath(pathname)}/login?returnTo=${encodeURIComponent(returnTo)}`);
      }
    }
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => { void loadSession(controller.signal); }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
      requestVersion.current += 1;
    };
  }, [loadSession]);

  const switchTenant = useCallback(async (organizationId: string) => {
    setStatus("switching_tenant");
    setError(null);
    setSession(null);
    setAuthorization(null);
    try {
      await selectOrganization(organizationId);
      await loadSession();
    } catch (cause) {
      const requestError = cause instanceof ApiError
        ? cause
        : new ApiError(0, "No se pudo activar la organización.", "TENANT_SWITCH_ERROR", {}, cause);
      setError(requestError);
      setStatus(statusForError(requestError));
      throw requestError;
    }
  }, [loadSession]);

  const value = useMemo<SessionContextValue>(() => ({
    status,
    session,
    authorization,
    organizations,
    error,
    refreshSession: async () => loadSession(),
    switchTenant,
  }), [authorization, error, loadSession, organizations, session, status, switchTenant]);

  if (status === "checking" || status === "switching_tenant" || status === "tenant_required") {
    return <div className="grid min-h-screen place-items-center text-body-sm text-muted-foreground">Validando sesión…</div>;
  }
  if (status === "unauthenticated") return null;
  if (status === "forbidden") {
    return <main className="grid min-h-screen place-items-center px-4"><div className="max-w-form space-y-4 text-center"><p role="alert" aria-live="polite" className="text-body-sm text-destructive">{error?.message ?? "No tienes acceso a este contexto."}</p><Link href={`/${localeFromPath(pathname)}/login`} className="font-semibold text-primary underline">Volver a iniciar sesión</Link></div></main>;
  }
  if (status === "error") {
    return <main className="grid min-h-screen place-items-center px-4"><div className="max-w-form space-y-4 text-center"><p role="alert" aria-live="polite" className="text-body-sm text-destructive">{error?.message ?? "No se pudo validar la sesión."}</p><button type="button" onClick={() => void loadSession()} className="font-semibold text-primary underline">Reintentar</button></div></main>;
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession debe usarse dentro de SessionProvider");
  return value;
}
