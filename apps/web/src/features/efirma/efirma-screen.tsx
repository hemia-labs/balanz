"use client";
import { SatPanel } from "@/features/sat-download/sat-panel";
import { satRecovery } from "@/features/sat-download/sat-state";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAccountingContext } from "@/components/accounting-context";
import { Surface, Field, DefinitionGrid } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient, ApiError } from "@/lib/api-client";
import { submitCustody } from "./submit-custody";
import { useClientDetail } from "@/features/clients/use-client-detail";
import {
  activeCustody,
  credentialFileError,
  recoveryIds,
  custodyLabels,
  type CustodyState,
} from "./credential-state";

export function EfirmaScreen({ clientId }: { clientId: string }) {
  const { organization, capabilities, locale } = useAccountingContext();
  const query = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ids = recoveryIds(new URLSearchParams(query.toString()));
  const { detail, loading, error } = useClientDetail(clientId, {
    legalEntityId: ids.entityId ?? undefined,
  });
  const [page, setPage] = useState(1);
  const listed = useClientDetail(clientId, { legalEntityPage: page });
  const entities = listed.detail?.legalEntities.items ?? [];
  const entity = detail?.legalEntities.items.find(
    (item) => item.id === ids.entityId,
  );
  if (!capabilities.includes("credentials.manage"))
    return <p>No tienes permiso para administrar credenciales.</p>;
  return (
    <div className="space-y-5">
      <h1 className="text-page-title">e.firma temporal</h1>
      <p>
        La custodia y descarga SAT admiten únicamente certificados sintéticos en
        QA aislado.
      </p>
      {loading ? (
        <p role="status">Consultando entidad fiscal…</p>
      ) : error ? (
        <p role="alert">No se pudo consultar la entidad fiscal.</p>
      ) : null}
      <Field label="Entidad fiscal">
        <select
          className="h-10 rounded-md border bg-background px-3"
          value={ids.entityId ?? ""}
          onChange={(event) =>
            router.replace(
              `${pathname}?entityId=${encodeURIComponent(event.target.value)}`,
            )
          }
        >
          <option value="">Selecciona una entidad</option>
          {entity && !entities.some((item) => item.id === entity.id) ? (
            <option value={entity.id}>
              {entity.legalName} · {entity.rfc}
            </option>
          ) : null}
          {entities.map((item) => (
            <option key={item.id} value={item.id}>
              {item.legalName} · {item.rfc}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-3">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage((value) => value - 1)}
        >
          Entidades anteriores
        </Button>
        <Button
          variant="outline"
          disabled={page >= (listed.detail?.legalEntities.meta.totalPages ?? 1)}
          onClick={() => setPage((value) => value + 1)}
        >
          Más entidades
        </Button>
      </div>
      {entity && capabilities.includes("sat.download") ? (
        <SatPanel
          key={`sat:${organization.id}:${entity.id}`}
          entityId={entity.id}
          cfdiHref={(id) =>
            `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients/${encodeURIComponent(clientId)}/legal-entities/${encodeURIComponent(entity.id)}/cfdi/${encodeURIComponent(id)}`
          }
          recoveryId={satRecovery(new URLSearchParams(query.toString()))}
          onCreated={(id) =>
            router.replace(`${pathname}?entityId=${entity.id}&satJob=${id}`)
          }
        />
      ) : null}
      {entity ? (
        <CustodyForm
          key={`${organization.id}:${entity.id}`}
          entityId={entity.id}
          recoveryId={ids.custodyId}
          onPrepared={(id) =>
            router.replace(`${pathname}?entityId=${entity.id}&custodyId=${id}`)
          }
        />
      ) : null}
    </div>
  );
}

function CustodyForm({
  entityId,
  recoveryId,
  onPrepared,
}: {
  entityId: string;
  recoveryId: string | null;
  onPrepared: (id: string) => void;
}) {
  const [state, setState] = useState<CustodyState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const grant = useRef("");
  const certificate = useRef<HTMLInputElement>(null);
  const key = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const totp = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const base = `/legal-entities/${entityId}`;
  const clear = () => {
    grant.current = "";
    for (const input of [certificate, key, password, totp])
      if (input.current) input.current.value = "";
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      clear();
    };
  }, []);
  useEffect(() => {
    if (!recoveryId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await apiClient<CustodyState>(
          `${base}/efirma-sessions/${recoveryId}`,
          { signal: abort.signal, cache: "no-store" },
        );
        if (abort.signal.aborted) return;
        setState(value);
        if (activeCustody(value))
          timer = setTimeout(() => {
            void poll();
          }, 2000);
      } catch {
        if (!abort.signal.aborted)
          setError(
            "No se pudo recuperar la custodia. Recarga para consultar su estado.",
          );
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [base, recoveryId]);
  const failure = (cause: unknown) => {
    if (
      alive.current &&
      cause instanceof ApiError &&
      cause.details &&
      typeof cause.details === "object"
    ) {
      const details = cause.details as {
        efirmaSessionId?: unknown;
        legalEntityId?: unknown;
      };
      if (
        details.legalEntityId === entityId &&
        typeof details.efirmaSessionId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          details.efirmaSessionId,
        )
      )
        onPrepared(details.efirmaSessionId);
    }
    if (alive.current)
      setError(
        cause instanceof ApiError && cause.code === "EFIRMA_DISABLED"
          ? "La custodia temporal está desactivada en este ambiente."
          : "No se pudo completar la operación. Revisa los datos o vuelve a autorizar.",
      );
  };
  async function authorize(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      const value = await apiClient<{ grant: string }>(
        `${base}/reauth-grants`,
        {
          method: "POST",
          body: JSON.stringify({ code: totp.current?.value }),
          signal: controller.current.signal,
          cache: "no-store",
        },
      );
      if (alive.current) {
        grant.current = value.grant;
        setAuthorized(true);
      }
    } catch (cause) {
      failure(cause);
    } finally {
      if (totp.current) totp.current.value = "";
      if (alive.current) setBusy(false);
    }
  }
  async function prepare(event: FormEvent) {
    event.preventDefault();
    const cert = certificate.current?.files?.[0];
    const privateKey = key.current?.files?.[0];
    const invalid =
      credentialFileError(cert, ".cer") ??
      credentialFileError(privateKey, ".key");
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      const result = await submitCustody(
        entityId,
        {
          certificate: cert!,
          key: privateKey!,
          password: password.current?.value ?? "",
          grant: grant.current,
          replacesId: state && !activeCustody(state) ? state.id : undefined,
        },
        controller.current.signal,
      );
      if (alive.current) {
        setState(result);
        onPrepared(result.id);
      }
    } catch (cause) {
      failure(cause);
    } finally {
      clear();
      if (alive.current) {
        setAuthorized(false);
        setBusy(false);
      }
    }
  }
  async function revoke() {
    if (!state) return;
    setBusy(true);
    try {
      const value = await apiClient<CustodyState>(
        `${base}/efirma-sessions/${state.id}/revoke`,
        { method: "POST", cache: "no-store" },
      );
      if (alive.current) setState(value);
    } catch (cause) {
      failure(cause);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Surface>
      <div className="space-y-5 p-5">
        <p>
          La llave permanece cifrada durante un máximo de 10 minutos. La
          contraseña se usa sólo para abrirla en memoria. Esto no comprueba
          revocación ante SAT.
        </p>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        {state ? (
          <div aria-live="polite">
            <DefinitionGrid
              items={[
                {
                  label: "Estado",
                  value: custodyLabels[state.status] ?? "Estado no disponible",
                },
                {
                  label: "Vence",
                  value: new Date(state.expiresAt).toLocaleString("es-MX"),
                },
                {
                  label: "Validación local",
                  value:
                    state.localValidation === "local_validation_passed"
                      ? "Aprobada para certificado sintético"
                      : "No aprobada",
                },
                { label: "Revocación ante SAT", value: "Desconocida" },
              ]}
            />
            {activeCustody(state) ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void revoke();
                }}
              >
                Revocar custodia
              </Button>
            ) : (
              <p>
                Para otra entrega necesitas un código TOTP fresco y una nueva
                autorización.
              </p>
            )}
          </div>
        ) : null}
        {!state || !activeCustody(state) ? (
          <>
            <form onSubmit={authorize} className="space-y-3">
              <Field label="Código de tu aplicación autenticadora">
                <Input
                  ref={totp}
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  disabled={busy}
                />
              </Field>
              <Button disabled={busy || authorized}>
                Autorizar preparación temporal
              </Button>
            </form>
            {authorized ? (
              <form onSubmit={prepare} className="space-y-3" autoComplete="off">
                <Field label="Certificado .cer">
                  <Input
                    ref={certificate}
                    type="file"
                    accept=".cer"
                    required
                    disabled={busy}
                  />
                </Field>
                <Field label="Llave protegida .key">
                  <Input
                    ref={key}
                    type="file"
                    accept=".key"
                    required
                    disabled={busy}
                  />
                </Field>
                <Field label="Contraseña de la llave (distinta de tu contraseña de Hemia)">
                  <Input
                    ref={password}
                    type="password"
                    autoComplete="off"
                    maxLength={1024}
                    required
                    disabled={busy}
                  />
                </Field>
                <Button disabled={busy}>
                  {busy ? "Preparando…" : "Validar y custodiar temporalmente"}
                </Button>
              </form>
            ) : null}
          </>
        ) : null}
      </div>
    </Surface>
  );
}
