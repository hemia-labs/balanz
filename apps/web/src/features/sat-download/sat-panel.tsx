"use client";
import { useEffect, useRef, useState, useCallback, type FormEvent } from "react";
import { apiClient, ApiError } from "@/lib/api-client";
import { submitSatAuthorization } from "./sat-client";
import { Field, Surface } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { credentialFileError } from "@/features/efirma/credential-state";
import {
  satLabels,
  pollSat,
  canAuthorizeSat,
  type SatProcess,
  type SatPackage,
} from "./sat-state";
export function SatPanel({
  entityId,
  recoveryId,
  onCreated,
  cfdiHref,
}: {
  cfdiHref: (id: string) => string;
  entityId: string;
  recoveryId: string | null;
  onCreated: (id: string) => void;
}) {
  const [process, setProcess] = useState<SatProcess | null>(null),
    [packages, setPackages] = useState<SatPackage[]>([]),
    [after, setAfter] = useState(0),
    [next, setNext] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [direction, setDirection] = useState("issued"),
    [revision, setRevision] = useState(0),
    [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null),
    alive = useRef(true),
    credentials = useRef<HTMLFormElement | null>(null),
    createAttempt = useRef<{ body: string; key: string } | null>(null);
  const [recent, setRecent] = useState<SatProcess[]>([]);
  useEffect(() => {
    if (recoveryId) return;
    const abort = new AbortController();
    void apiClient<{ items: SatProcess[] }>(
      "/sat-download-jobs?legalEntityId=" + entityId + "&limit=25",
      { signal: abort.signal, cache: "no-store" },
    )
      .then((p) => {
        if (!abort.signal.aborted) setRecent(p.items);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [entityId, recoveryId]);
  const bindCredentials=useCallback((node:HTMLFormElement|null)=>{if(credentials.current&&credentials.current!==node)credentials.current.reset();credentials.current=node;},[]);
  const base = "/sat-download-jobs";
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!recoveryId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const p = await apiClient<SatProcess>(base + "/" + recoveryId, {
          signal: abort.signal,
          cache: "no-store",
        });
        if (abort.signal.aborted) return;
        if (p.legalEntityId !== entityId) throw new Error();
        setProcess(p);
        const page = await apiClient<{
          items: SatPackage[];
          nextAfter: number | null;
        }>(base + "/" + recoveryId + "/packages?after=" + after + "&limit=50", {
          signal: abort.signal,
          cache: "no-store",
        });
        if (abort.signal.aborted) return;
        setPackages(page.items);
        setNext(page.nextAfter);
        if (pollSat(p.status)) timer = setTimeout(load, 2500);
      } catch {
        if (!abort.signal.aborted)
          setError("No se pudo recuperar el proceso. Vuelve a consultar.");
      }
    }
    void load();
    return () => {
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [recoveryId, entityId, after, revision]);
  async function action(work: (signal: AbortSignal) => Promise<void>) {
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      await work(controller.current.signal);
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof ApiError && e.code === "SAT_DISABLED"
            ? "La descarga SAT está desactivada en este ambiente."
            : "No se pudo completar la operación. Revisa los datos y vuelve a consultar el proceso.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void action(async (signal) => {
      const contentType = String(fields.get("contentType"));
      const input = {
        legalEntityId: entityId,
        direction,
        contentType,
        documentType: String(fields.get("documentType")),
        documentStatus:
          direction === "received" && contentType === "xml"
            ? "active"
            : String(fields.get("documentStatus")),
        ...(direction === "folio"
          ? { folio: String(fields.get("folio")) }
          : {
              dateFrom: String(fields.get("dateFrom")) + ":00",
              dateTo: String(fields.get("dateTo")) + ":00",
            }),
      };
      const body = JSON.stringify(input);
      if (createAttempt.current?.body !== body)
        createAttempt.current = { body, key: crypto.randomUUID() };
      const row = await apiClient<SatProcess>(base, {
        method: "POST",
        headers: { "Idempotency-Key": createAttempt.current.key },
        body,
        signal,
      });
      if (alive.current) {
        setProcess(row);
        onCreated(row.id);
      }
    });
  }
  function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!process) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const certificate = data.get("certificate") as File,
      key = data.get("key") as File;
    const invalid =
      credentialFileError(certificate, ".cer") ??
      credentialFileError(key, ".key");
    if (invalid) {
      setError(invalid);
      return;
    }
    void action(async (signal) => {
      try {
        await submitSatAuthorization(process.id, data, signal);
        if (alive.current) {
          const current = await apiClient<SatProcess>(base + "/" + process.id, {
            signal,
            cache: "no-store",
          });
          setProcess(current);
          setAfter(0);
          setRevision((v) => v + 1);
        }
      } finally {
        for (const name of ["code", "grant", "certificate", "key", "password"])
          data.delete(name);
        form.reset();
      }
    });
  }
  async function command(path: string) {
    await action(async (signal) => {
      await apiClient(base + "/" + recoveryId + "/" + path, {
        method: "POST",
        signal,
      });
      const row = await apiClient<SatProcess>(base + "/" + recoveryId, {
        signal,
        cache: "no-store",
      });
      if (alive.current) {
        setProcess(row);
        setAfter(0);
        setRevision((v) => v + 1);
      }
    });
  }
  return (
    <Surface labelledBy="sat-heading">
      <h2 id="sat-heading" className="text-lg font-semibold">
        Descarga SAT a solicitud
      </h2>
      <p>
        Disponible únicamente para pruebas aisladas con certificados sintéticos.
        No ingreses una e.firma real.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {!recoveryId && recent.length ? (
        <section aria-label="Procesos SAT recientes">
          <h3>Continuar un proceso</h3>
          <ul>
            {recent.map((p) => (
              <li key={p.id}>
                <Button variant="outline" onClick={() => onCreated(p.id)}>
                  {satLabels[p.status] ?? "Consultar proceso"}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!recoveryId ? (
        <form onSubmit={create} className="space-y-4">
          <Field label="Comprobantes">
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="h-10 rounded-md border bg-background px-3"
            >
              <option value="issued">Emitidos</option>
              <option value="received">Recibidos</option>
              <option value="folio">Por folio fiscal</option>
            </select>
          </Field>
          <Field label="Información">
            <select
              name="contentType"
              className="h-10 rounded-md border bg-background px-3"
            >
              <option value="xml">XML CFDI</option>
              {direction !== "folio" ? (
                <option value="metadata">Metadata</option>
              ) : null}
            </select>
          </Field>
          {direction === "folio" ? (
            <Field label="Folio fiscal">
              <Input name="folio" required />
            </Field>
          ) : (
            <>
              <Field label="Desde (fecha de emisión)">
                <Input type="datetime-local" name="dateFrom" required />
              </Field>
              <Field label="Hasta">
                <Input type="datetime-local" name="dateTo" required />
              </Field>
            </>
          )}
          <Field label="Tipo de comprobante">
            <select
              name="documentType"
              className="h-10 rounded-md border bg-background px-3"
            >
              <option value="I">Ingreso</option>
              <option value="E">Egreso</option>
              <option value="T">Traslado</option>
              <option value="P">Pago</option>
            </select>
          </Field>
          <Field label="Estado">
            <select
              name="documentStatus"
              className="h-10 rounded-md border bg-background px-3"
            >
              <option value="active">Vigente</option>
              <option value="cancelled">Cancelado (metadata o emitidos)</option>
              <option value="all">Todos (metadata o emitidos)</option>
            </select>
          </Field>
          <Button disabled={busy}>Crear proceso</Button>
        </form>
      ) : null}
      {process ? (
        <div className="space-y-4">
          <p role="status">
            {satLabels[process.status] ?? "Consultando estado"}
          </p>
          {process.request?.external_id ? (
            <p>Folio de solicitud: {process.request.external_id}</p>
          ) : null}
          <p>
            Paquetes recuperados: {process.counters?.retrieved ?? 0} de{" "}
            {process.counters?.total ?? 0}. Paquetes procesados:{" "}
            {process.counters?.processed ?? 0}. CFDI incorporados:{" "}
            {process.counters?.incorporated ?? 0}.
          </p>
          {process.contentType === "metadata" ? (
            <p>Observaciones metadata: {process.counters?.metadataObservations ?? 0}. La metadata no crea CFDI sin XML.</p>
          ) : null}
          {canAuthorizeSat(process.status) ? (
            <form ref={bindCredentials} onSubmit={authorize} className="space-y-3">
              <p>
                Esta autorización permite continuar este mismo proceso durante
                un máximo de diez minutos. La contraseña se usa únicamente para
                abrir la llave.
              </p>
              <Field label="Código de autenticación">
                <Input
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  autoComplete="off"
                  required
                />
              </Field>
              <Field label="Certificado .cer">
                <Input name="certificate" type="file" accept=".cer" required />
              </Field>
              <Field label="Llave .key">
                <Input name="key" type="file" accept=".key" required />
              </Field>
              <Field label="Contraseña de la llave">
                <Input
                  name="password"
                  type="password"
                  autoComplete="off"
                  required
                />
              </Field>
              <Button disabled={busy}>Autorizar y continuar</Button>
            </form>
          ) : null}
          <div className="flex gap-3">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(async (signal) => {
                  const row = await apiClient<SatProcess>(
                    base + "/" + recoveryId,
                    { signal, cache: "no-store" },
                  );
                  if (alive.current) setProcess(row);
                })
              }
            >
              Consultar estado
            </Button>
            <Button
              variant="outline"
              disabled={
                busy || ["cancelled", "completed"].includes(process.status)
              }
              onClick={() => void command("cancel")}
            >
              Cancelar en Hemia
            </Button>
            {process.status === "failed" ? (
              <Button disabled={busy} onClick={() => void command("retry")}>
                Solicitar reintento
              </Button>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Paquete</th>
                  <th className="text-left">Estado</th>
                  <th className="text-left">Intentos de descarga</th>
                  <th className="text-left">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td>{p.ordinal}</td>
                    <td>
                      {(
                        {
                          pending: "Pendiente",
                          downloading: "Recuperando",
                          download_unknown: "Respuesta de descarga incierta",
                          stored: "Recuperado",
                          processing: "Procesando archivos",
                          completed: "Procesado",
                          with_issues: "Procesado con incidencias",
                          failed: "No se pudo procesar",
                          expired: "Vencido",
                          budget_exhausted: "Intentos agotados",
                        } as Record<string, string>
                      )[p.status] ?? "Consultar incidencia"}
                    </td>
                    <td>
                      {p.download_attempts} de 2
                      {p.uncertain_attempts
                        ? " (incluye respuestas inciertas)"
                        : ""}
                    </td>
                    <td>
                      <Button
                        variant="outline"
                        onClick={() => setSelectedPackage(p.id)}
                      >
                        Ver resultados
                      </Button>
                      {["failed", "download_unknown"].includes(p.status) ? (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void command("packages/" + p.id + "/retry")
                          }
                        >
                          Reintentar paquete
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              disabled={after === 0}
              onClick={() => setAfter(0)}
            >
              Primeros paquetes
            </Button>
            <Button
              variant="outline"
              disabled={next === null}
              onClick={() => setAfter(next!)}
            >
              Siguientes paquetes
            </Button>
          </div>
        </div>
      ) : null}
      {selectedPackage && recoveryId ? (
        <SatResults
          key={selectedPackage}
          jobId={recoveryId}
          packageId={selectedPackage}
          cfdiHref={cfdiHref}
        />
      ) : null}
    </Surface>
  );
}

function SatResults({
  jobId,
  packageId,
  cfdiHref,
}: {
  jobId: string;
  packageId: string;
  cfdiHref: (id: string) => string;
}) {
  const [after, setAfter] = useState(0),
    [page, setPage] = useState<{
      items: {
        id: string;
        ordinal: number;
        filename: string;
        result: string | null;
        cfdiId: string | null;
      }[];
      nextAfter: number | null;
    } | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void apiClient<NonNullable<typeof page>>(
      "/sat-download-jobs/" +
        jobId +
        "/packages/" +
        packageId +
        "/items?after=" +
        after +
        "&limit=50",
      { signal: abort.signal, cache: "no-store" },
    )
      .then((p) => {
        if (!abort.signal.aborted) setPage(p);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [jobId, packageId, after]);
  return (
    <section aria-label="Resultados del paquete">
      <h3>Resultados del paquete</h3>
      {error ? (
        <p role="alert">No se pudieron consultar los resultados.</p>
      ) : null}
      <ul>
        {page?.items.map((item) => (
          <li key={item.id}>
            {item.ordinal}. {item.filename}:{" "}
            {(
              {
                incorporated: "Procesado",
                duplicate: "Duplicado",
                invalid: "Inválido",
                unsupported: "No soportado",
                foreign: "De otra entidad",
                internal_error: "No se pudo procesar",
              } as Record<string, string>
            )[item.result ?? ""] ?? "Pendiente"}{" "}
            {item.cfdiId ? (
              <a className="underline" href={cfdiHref(item.cfdiId)}>
                Ver CFDI
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        disabled={after === 0}
        onClick={() => setAfter(0)}
      >
        Primeras entradas
      </Button>
      <Button
        variant="outline"
        disabled={page?.nextAfter == null}
        onClick={() => setAfter(page!.nextAfter!)}
      >
        Siguientes entradas
      </Button>
    </section>
  );
}
