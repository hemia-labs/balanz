"use client";

import Link from "next/link";
import Image from "next/image";
import { LoaderCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError, isAbortError, subscribeToUnauthorizedApi } from "@/lib/api-client";
import { selectOrganization } from "@/features/organizations/api";
import { getAuthorization, getSession } from "@/features/session/api";
import { getOrganizations } from "@/features/organizations/api";
import { localeFromPath, unauthorizedLoginDestination } from "./unauthorized-navigation";
import type { AuthorizationContext, OrganizationSummary, SessionDetails, SessionState } from "./types";

interface SessionContextValue {
  status: SessionState;
  session: SessionDetails | null;
  authorization: AuthorizationContext | null;
  organizations: OrganizationSummary[];
  error: ApiError | null;
  refreshSession: () => Promise<void>;
  switchTenant: (organizationId: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function statusForError(error: ApiError): SessionState {
  if (error.code === "MFA_REQUIRED" || error.code === "MFA_SETUP_REQUIRED" || error.status === 403) return "forbidden";
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
  const [session, setSession] = useState<SessionDetails | null>(null);
  const [authorization, setAuthorization] = useState<AuthorizationContext | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    navigationRef.current = { pathname, search };
  }, [pathname, search]);

  const invalidateSession = useCallback((requestError: ApiError) => {
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
  }, [router]);

  useEffect(
    () => subscribeToUnauthorizedApi(({ error: requestError }) => {
      invalidateSession(requestError);
    }),
    [invalidateSession],
  );

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
        router.replace(`/${localeFromPath(navigationRef.current.pathname)}/select-organization`);
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
  }, [invalidateSession, router]);

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
      if (requestError.status === 401) invalidateSession(requestError);
      else {
        setError(requestError);
        setStatus(statusForError(requestError));
      }
      throw requestError;
    }
  }, [invalidateSession, loadSession]);

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
    const statusMessage = status === "switching_tenant" ? "Cambiando de despacho…" : "Validando sesión…";
    return (
      <main id="main-content" tabIndex={-1} className="grid min-h-screen w-full flex-1 place-items-center bg-background px-4 focus:outline-none">
        <Card className="w-full max-w-sm rounded-lg border-border py-0 shadow-float ring-0" aria-busy="true">
          <CardContent className="flex flex-col items-center p-7 text-center sm:p-8">
            <Image src="/logo.png" alt="CFDIOS" width={230} height={58} priority className="mx-auto block h-auto w-52 dark:hidden" />
            <Image src="/logo-white.png" alt="CFDIOS" width={192} height={48} priority className="mx-auto hidden h-auto w-52 dark:block" />
            <div className="mt-7 flex size-11 items-center justify-center self-center rounded-lg bg-muted text-foreground">
              <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            </div>
            <p className="mt-5 text-heading-sm font-bold" role="status" aria-live="polite">{statusMessage}</p>
            <p className="mt-2 text-body-sm text-muted-foreground">Estamos preparando tu espacio de trabajo.</p>
          </CardContent>
        </Card>
      </main>
    );
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
