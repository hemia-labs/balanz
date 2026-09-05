"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import { PageHeader } from "@/components/page-header";
import {
  PermissionBoundary,
  PermissionGate,
} from "@/components/permission-gate";
import {
  DefinitionGrid,
  FeaturePendingNotice,
  Field,
  FilterBar,
  Surface,
  SurfaceHeader,
  WarningNotice,
} from "@/components/product-patterns";
import { ProductTable } from "@/components/product-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CollectionPagination,
  ErrorNotice,
  LoadingState,
  selectClass,
} from "@/features/clients/live-screen-primitives";
import { useDebouncedValue } from "@/features/clients/live-query-hooks";
import { useClientDetail } from "@/features/clients/use-client-detail";
import { LatestIngestionPanel } from "@/features/ingestions/ingestion-status-panel";
import { XmlUploadDialog } from "@/features/ingestions/xml-upload-dialog";
import { ApiError } from "@/lib/api-client";
import { createCfdiAccessUrl, type CfdiListQuery } from "./api";
import { formatExactDecimal, formatExactMoney } from "./exact-decimal";
import type { CfdiDetail, CfdiListItem, CfdiPayment, CfdiType } from "./types";
import { useCfdiDetail, useCfdiPage } from "./use-cfdi-data";

const typeLabels: Record<CfdiType, string> = {
  I: "Ingreso",
  E: "Egreso",
  T: "Traslado",
  N: "Nómina",
  P: "Pago",
};
const monthNames = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-MX");
}

function clientBase(
  locale: string,
  organizationSlug: string,
  clientId: string,
) {
  return `/${locale}/organizations/${encodeURIComponent(organizationSlug)}/clients/${encodeURIComponent(clientId)}`;
}

function cfdiBase(
  locale: string,
  organizationSlug: string,
  clientId: string,
  legalEntityId: string,
) {
  return `${clientBase(locale, organizationSlug, clientId)}/legal-entities/${encodeURIComponent(legalEntityId)}/cfdi`;
}

function LegalEntityCfdiSelector({ clientId }: { clientId: string }) {
  const { organization, locale } = useAccountingContext();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const { detail, loading, error } = useClientDetail(clientId, {
    legalEntityPage: page,
    legalEntityLimit: 20,
    legalEntitySearch: debouncedSearch,
  });
  const base = clientBase(locale, organization.slug, clientId);
  useEffect(() => {
    if (
      detail?.legalEntities.meta.total === 1 &&
      detail.legalEntities.items.length === 1 &&
      !debouncedSearch
    ) {
      router.replace(
        `${base}/legal-entities/${encodeURIComponent(detail.legalEntities.items[0].id)}/cfdi`,
      );
    }
  }, [base, debouncedSearch, detail, router]);
  if (loading) return <LoadingState label="Cargando entidades fiscales…" />;
  if (error || !detail)
    return (
      <ErrorNotice error={error} fallback="No se pudo cargar el cliente." />
    );
  if (
    detail.legalEntities.meta.total === 1 &&
    detail.legalEntities.items.length === 1 &&
    !debouncedSearch
  )
    return <LoadingState label="Abriendo el único RFC…" />;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CFDI"
        title="Selecciona un RFC"
        description="Elige la entidad fiscal que deseas consultar. La aplicación no asumirá un RFC arbitrario."
      />
      <Surface>
        <FilterBar>
          <Field label="Buscar entidad fiscal">
            <Input
              type="search"
              value={search}
              maxLength={120}
              placeholder="Razón social o RFC"
              onChange={(event) => {
                setSearch(event.target.value.slice(0, 120));
                setPage(1);
              }}
              className="w-72"
            />
          </Field>
        </FilterBar>
        <ProductTable
          caption="Entidades fiscales disponibles para consultar CFDI"
          rows={detail.legalEntities.items}
          rowKey={(entity) => entity.id}
          emptyMessage="No hay entidades fiscales que coincidan con la búsqueda."
          columns={[
            {
              id: "entity",
              header: "Entidad fiscal",
              render: (entity) => (
                <div>
                  <Link
                    href={`${base}/legal-entities/${encodeURIComponent(entity.id)}/cfdi`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {entity.legalName}
                  </Link>
                  <p className="identifier text-caption text-muted-foreground">
                    {entity.rfc}
                  </p>
                </div>
              ),
            },
            {
              id: "status",
              header: "Estado",
              render: (entity) => <StatusBadge status={entity.status} />,
            },
            {
              id: "action",
              header: "Acción",
              render: (entity) => (
                <Button
                  render={
                    <Link
                      href={`${base}/legal-entities/${encodeURIComponent(entity.id)}/cfdi`}
                    />
                  }
                  size="sm"
                  variant="outline"
                >
                  Consultar CFDI
                </Button>
              ),
            },
          ]}
        />
        <CollectionPagination
          meta={detail.legalEntities.meta}
          itemLabel="entidades fiscales"
          onPageChange={setPage}
        />
      </Surface>
    </div>
  );
}

export function LiveClientCfdiScreen({
  clientId,
  legalEntityId,
}: {
  clientId: string;
  legalEntityId?: string;
}) {
  if (!legalEntityId) return <LegalEntityCfdiSelector clientId={clientId} />;
  return <CfdiListScreen clientId={clientId} legalEntityId={legalEntityId} />;
}

function CfdiListScreen({
  clientId,
  legalEntityId,
}: {
  clientId: string;
  legalEntityId: string;
}) {
  const { organization, locale } = useAccountingContext();
  const [page, setPage] = useState(1);
  const [uuid, setUuid] = useState("");
  const [counterpartyRfc, setCounterpartyRfc] = useState("");
  const [type, setType] = useState<CfdiType | "">("");
  const debouncedUuid = useDebouncedValue(uuid.trim());
  const debouncedCounterpartyRfc = useDebouncedValue(
    counterpartyRfc.trim().toUpperCase(),
  );
  const uuidIsComplete =
    !debouncedUuid || /^[0-9a-fA-F-]{36}$/.test(debouncedUuid);
  const {
    detail,
    loading: contextLoading,
    error: contextError,
  } = useClientDetail(clientId, { legalEntityId, legalEntityLimit: 100 });
  const entity = detail?.legalEntities.items.find(
    (candidate) => candidate.id === legalEntityId,
  );
  const query = useMemo<CfdiListQuery>(
    () => ({
      page,
      limit: 20,
      documentType: type || undefined,
      uuid: uuidIsComplete && debouncedUuid ? debouncedUuid : undefined,
      counterpartyRfc: debouncedCounterpartyRfc || undefined,
      sort: "issuedAt",
      direction: "desc",
    }),
    [debouncedCounterpartyRfc, debouncedUuid, page, type, uuidIsComplete],
  );
  const { data, loading, error, reload } = useCfdiPage({
    organizationId: organization.id,
    legalEntityId,
    query,
  });
  const base = cfdiBase(locale, organization.slug, clientId, legalEntityId);
  if (contextLoading) return <LoadingState label="Cargando contexto fiscal…" />;
  if (contextError || !detail)
    return (
      <ErrorNotice
        error={contextError}
        fallback="No se pudo cargar el cliente."
      />
    );
  if (!entity)
    return (
      <ErrorNotice
        error={new ApiError(404, "CFDI_NOT_FOUND", "CFDI_NOT_FOUND")}
        fallback="La entidad fiscal no existe o ya no tienes acceso."
      />
    );
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CFDI 4.0"
        title={`CFDI de ${entity.legalName}`}
        description={`${detail.account.name} · RFC ${entity.rfc}. Los resultados corresponden al RFC, no al mes desde el que se inició la carga.`}
        actions={
          <PermissionGate capability="ingestion.create">
            <XmlUploadDialog
              key={`${organization.id}:${clientId}:${legalEntityId}`}
              scope={{
                organizationId: organization.id,
                clientAccountId: clientId,
                legalEntityId,
              }}
              disabled={entity.status !== "active"}
            />
          </PermissionGate>
        }
      />
      {entity.status !== "active" ? (
        <WarningNotice>
          Este RFC no está activo. Puedes consultar sus CFDI, pero no iniciar
          nuevas cargas.
        </WarningNotice>
      ) : null}
      <FeaturePendingNotice>
        Esta fase admite un XML por carga. ZIP y sincronización SAT permanecen
        no disponibles.
      </FeaturePendingNotice>
      <LatestIngestionPanel
        scope={{
          organizationId: organization.id,
          clientAccountId: clientId,
          legalEntityId,
        }}
        cfdiHref={(cfdiId) => `${base}/${encodeURIComponent(cfdiId)}`}
        onTerminal={reload}
      />
      <Surface>
        <SurfaceHeader
          title="Comprobantes incorporados"
          description="Lista persistida del dominio fiscal para este RFC."
          actions={
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Actualizar
            </Button>
          }
        />
        <FilterBar>
          <Field label="UUID">
            <Input
              type="search"
              value={uuid}
              maxLength={36}
              placeholder="UUID completo"
              aria-invalid={!uuidIsComplete}
              onChange={(event) => {
                setUuid(event.target.value.slice(0, 36));
                setPage(1);
              }}
              className="w-72"
            />
            {!uuidIsComplete ? (
              <span className="text-caption text-destructive">
                Escribe el UUID completo de 36 caracteres.
              </span>
            ) : null}
          </Field>
          <Field label="RFC contraparte">
            <Input
              type="search"
              value={counterpartyRfc}
              maxLength={13}
              placeholder="RFC emisor o receptor"
              onChange={(event) => {
                setCounterpartyRfc(event.target.value.slice(0, 13));
                setPage(1);
              }}
              className="w-56 uppercase"
            />
          </Field>
          <Field label="Tipo">
            <select
              className={selectClass}
              value={type}
              onChange={(event) => {
                setType(event.target.value as CfdiType | "");
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </FilterBar>
        {loading ? (
          <div className="p-5">
            <LoadingState label="Cargando CFDI…" />
          </div>
        ) : error || !data ? (
          <div className="space-y-3 p-5">
            <ErrorNotice
              error={error}
              fallback="No se pudieron cargar los CFDI."
            />
            <Button type="button" variant="outline" onClick={reload}>
              Reintentar
            </Button>
          </div>
        ) : (
          <>
            <CfdiListTable
              rows={data.items}
              base={base}
              entityRfc={entity.rfc}
            />
            <CollectionPagination
              meta={data.meta}
              itemLabel="CFDI"
              onPageChange={setPage}
            />
          </>
        )}
      </Surface>
    </div>
  );
}

function CfdiListTable({
  rows,
  base,
  entityRfc,
}: {
  rows: CfdiListItem[];
  base: string;
  entityRfc: string;
}) {
  return (
    <ProductTable
      caption="CFDI persistidos para la entidad fiscal"
      rows={rows}
      rowKey={(cfdi) => cfdi.id}
      emptyMessage="Todavía no hay CFDI incorporados para este RFC."
      columns={[
        {
          id: "uuid",
          header: "UUID",
          render: (cfdi) => (
            <div className="max-w-72">
              <Link
                href={`${base}/${encodeURIComponent(cfdi.id)}`}
                className="identifier break-all font-semibold text-primary hover:underline"
              >
                {cfdi.uuid}
              </Link>
              <p className="text-caption text-muted-foreground">
                {typeLabels[cfdi.type]} · {directionForEntity(cfdi, entityRfc)}
              </p>
            </div>
          ),
        },
        {
          id: "counterparty",
          header: "Emisor / receptor",
          render: (cfdi) => (
            <div>
              <p>{cfdi.issuerName ?? cfdi.issuerRfc}</p>
              <p className="text-caption text-muted-foreground">
                {cfdi.receiverName ?? cfdi.receiverRfc}
              </p>
            </div>
          ),
        },
        {
          id: "date",
          header: "Fecha",
          render: (cfdi) => dateTime(cfdi.issuedAt),
        },
        {
          id: "total",
          header: "Total",
          numeric: true,
          render: (cfdi) => formatExactMoney(cfdi.total, cfdi.currency),
        },
        { id: "version", header: "Versión", render: (cfdi) => cfdi.version },
      ]}
    />
  );
}

function directionForEntity(cfdi: CfdiListItem, entityRfc: string) {
  const target = entityRfc.trim().toUpperCase();
  const issued = cfdi.issuerRfc.toUpperCase() === target;
  const received = cfdi.receiverRfc.toUpperCase() === target;
  if (issued && received) return "Emisor y receptor";
  if (issued) return "Emitido";
  if (received) return "Recibido";
  return "Sin clasificar";
}

type DetailTab =
  | "data"
  | "concepts"
  | "taxes"
  | "relations"
  | "payments-payroll"
  | "traceability";

const detailTabs: Array<{ id: DetailTab; label: string }> = [
  { id: "data", label: "Datos" },
  { id: "concepts", label: "Conceptos" },
  { id: "taxes", label: "Impuestos" },
  { id: "relations", label: "Relaciones" },
  { id: "payments-payroll", label: "Pagos y nómina" },
  { id: "traceability", label: "Origen y control" },
];

export function LiveCfdiDetailScreen({
  clientId,
  legalEntityId,
  cfdiId,
}: {
  clientId: string;
  legalEntityId: string;
  cfdiId: string;
}) {
  const { organization, locale, mfaVerifiedAt } = useAccountingContext();
  const [tab, setTab] = useState<DetailTab>("data");
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const { data, loading, error } = useCfdiDetail({
    organizationId: organization.id,
    cfdiId,
  });
  const base = cfdiBase(locale, organization.slug, clientId, legalEntityId);
  const mismatch = Boolean(
    data?.legalEntityId && data.legalEntityId !== legalEntityId,
  );
  const download = async () => {
    setDownloadPending(true);
    setDownloadError(null);
    try {
      const access = await createCfdiAccessUrl(cfdiId);
      if (!access.url)
        throw new ApiError(
          502,
          "La respuesta no incluye una URL temporal.",
          "INVALID_API_RESPONSE",
        );
      const anchor = document.createElement("a");
      anchor.href = access.url;
      anchor.rel = "noopener noreferrer";
      anchor.click();
    } catch (cause) {
      setDownloadError(cause);
    } finally {
      setDownloadPending(false);
    }
  };
  if (loading) return <LoadingState label="Cargando detalle CFDI…" />;
  if (error || !data || mismatch)
    return (
      <div className="space-y-3">
        <ErrorNotice
          error={
            mismatch
              ? new ApiError(404, "CFDI_NOT_FOUND", "CFDI_NOT_FOUND")
              : error
          }
          fallback="El CFDI no existe o ya no tienes acceso."
        />
        <Button render={<Link href={base} />} variant="outline">
          Volver a CFDI
        </Button>
      </div>
    );
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${typeLabels[data.type]} · CFDI ${data.version}`}
        title={data.uuid}
        description={`${dateTime(data.issuedAt)} · ${formatExactMoney(data.total, data.currency)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button render={<Link href={base} />} variant="outline">
              Volver a CFDI
            </Button>
            <PermissionGate capability="cfdi.download">
              {mfaVerifiedAt ? (
                <Button
                  type="button"
                  onClick={() => void download()}
                  disabled={downloadPending}
                >
                  <Download className="size-4" aria-hidden="true" />
                  {downloadPending ? "Preparando…" : "Descargar XML"}
                </Button>
              ) : (
                <Button
                  render={<Link href={`/${locale}/security`} />}
                  variant="outline"
                >
                  Verificar MFA para descargar
                </Button>
              )}
            </PermissionGate>
          </div>
        }
      />
      <ErrorNotice
        error={downloadError}
        fallback="No se pudo obtener el acceso temporal al XML."
      />
      <div
        className="overflow-x-auto border-b border-border"
        role="tablist"
        aria-label="Detalle del CFDI"
      >
        <div className="flex min-w-max gap-1 px-2">
          {detailTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`relative min-h-11 px-3 text-body-sm font-semibold ${
                tab === item.id
                  ? "text-foreground after:absolute after:bottom-0 after:left-3 after:right-3 after:h-0.5 after:bg-brand-mark"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel">
        <DetailTabContent tab={tab} cfdi={data} />
      </div>
    </div>
  );
}

function DetailTabContent({ tab, cfdi }: { tab: DetailTab; cfdi: CfdiDetail }) {
  if (tab === "data")
    return (
      <DefinitionGrid
        items={[
          { label: "Versión CFDI", value: cfdi.version || "—" },
          { label: "Versión de esquema", value: cfdi.schemaVersion || "—" },
          {
            label: "Emisor",
            value: `${cfdi.issuerName ?? "—"} · ${cfdi.issuerRfc}`,
          },
          {
            label: "Receptor",
            value: `${cfdi.receiverName ?? "—"} · ${cfdi.receiverRfc}`,
          },
          { label: "Fecha de timbrado", value: dateTime(cfdi.certifiedAt) },
          {
            label: "Subtotal",
            value: formatExactMoney(cfdi.subtotal, cfdi.currency),
          },
          {
            label: "Descuento",
            value: formatExactMoney(cfdi.discount, cfdi.currency),
          },
          {
            label: "Método / forma",
            value:
              [cfdi.paymentMethod, cfdi.paymentForm]
                .filter(Boolean)
                .join(" · ") || "—",
          },
          { label: "Lugar de expedición", value: cfdi.placeOfIssue ?? "—" },
        ]}
      />
    );
  if (tab === "concepts")
    return (
      <Surface>
        <ProductTable
          caption="Conceptos del CFDI"
          rows={cfdi.concepts}
          rowKey={(concept) => concept.id}
          emptyMessage="Este CFDI no contiene conceptos visibles."
          columns={[
            {
              id: "code",
              header: "Clave",
              render: (item) => item.productServiceCode,
            },
            {
              id: "description",
              header: "Descripción",
              render: (item) => item.description,
            },
            {
              id: "quantity",
              header: "Cantidad",
              numeric: true,
              render: (item) => formatExactDecimal(item.quantity),
            },
            {
              id: "unit",
              header: "Unidad",
              render: (item) => item.unit ?? item.unitCode,
            },
            {
              id: "amount",
              header: "Importe",
              numeric: true,
              render: (item) => formatExactMoney(item.amount, cfdi.currency),
            },
          ]}
        />
      </Surface>
    );
  if (tab === "taxes")
    return (
      <Surface>
        <ProductTable
          caption="Impuestos del CFDI"
          rows={cfdi.taxes}
          rowKey={(tax) => tax.id}
          emptyMessage="Este CFDI no contiene impuestos registrados."
          columns={[
            {
              id: "scope",
              header: "Nivel",
              render: (item) => taxScopeLabel(item.scope),
            },
            {
              id: "kind",
              header: "Tipo",
              render: (item) =>
                item.kind === "transfer" ? "Traslado" : "Retención",
            },
            { id: "tax", header: "Impuesto", render: (item) => item.taxCode },
            {
              id: "base",
              header: "Base",
              numeric: true,
              render: (item) => formatExactMoney(item.base, cfdi.currency),
            },
            {
              id: "rate",
              header: "Tasa o cuota",
              numeric: true,
              render: (item) => formatExactDecimal(item.rateOrQuota),
            },
            {
              id: "amount",
              header: "Importe",
              numeric: true,
              render: (item) => formatExactMoney(item.amount, cfdi.currency),
            },
          ]}
        />
      </Surface>
    );
  if (tab === "relations")
    return (
      <Surface>
        <ProductTable
          caption="Relaciones del CFDI"
          rows={cfdi.relations}
          rowKey={(relation) => relation.id}
          emptyMessage="Este CFDI no tiene comprobantes relacionados."
          columns={[
            {
              id: "type",
              header: "Tipo de relación",
              render: (item) => item.relationType,
            },
            {
              id: "uuid",
              header: "UUID relacionado",
              render: (item) => (
                <span className="identifier break-all">{item.relatedUuid}</span>
              ),
            },
          ]}
        />
      </Surface>
    );
  if (tab === "payments-payroll")
    return (
      <div className="space-y-6">
        <Payments payments={cfdi.payments} />
        <PermissionBoundary capability="payroll.view">
          <Payroll cfdi={cfdi} />
        </PermissionBoundary>
      </div>
    );
  return <Traceability cfdi={cfdi} />;
}

function Payments({ payments }: { payments: CfdiPayment[] }) {
  return (
    <Surface>
      <SurfaceHeader
        title="Pagos"
        description="Cada nodo Pago y sus documentos relacionados se muestran por separado."
      />
      {payments.length ? (
        <div className="divide-y divide-border">
          {payments.map((payment, index) => (
            <section
              key={payment.id || String(index)}
              className="space-y-4 p-5"
            >
              <DefinitionGrid
                items={[
                  { label: "Fecha de pago", value: dateTime(payment.paidAt) },
                  { label: "Forma", value: payment.paymentForm || "—" },
                  {
                    label: "Monto",
                    value: formatExactMoney(payment.amount, payment.currency),
                  },
                  {
                    label: "Tipo de cambio",
                    value: formatExactDecimal(payment.exchangeRate),
                  },
                  {
                    label: "RFC banco ordenante",
                    value: payment.payerBankRfc || "—",
                  },
                  {
                    label: "Banco ordenante extranjero",
                    value: payment.payerForeignBankName || "—",
                  },
                  {
                    label: "Cuenta ordenante",
                    value: payment.payerAccount || "—",
                  },
                  {
                    label: "RFC banco beneficiario",
                    value: payment.beneficiaryBankRfc || "—",
                  },
                  {
                    label: "Cuenta beneficiaria",
                    value: payment.beneficiaryAccount || "—",
                  },
                ]}
              />
              <ProductTable
                caption={`Documentos relacionados del pago ${index + 1}`}
                rows={payment.documents}
                rowKey={(document) =>
                  document.id ||
                  `${payment.id}-${document.relatedUuid}-${document.partialityNumber ?? "none"}`
                }
                emptyMessage="Este pago no contiene documentos relacionados."
                columns={[
                  {
                    id: "uuid",
                    header: "UUID",
                    render: (item) => (
                      <span className="identifier break-all">
                        {item.relatedUuid}
                      </span>
                    ),
                  },
                  {
                    id: "partiality",
                    header: "Parcialidad",
                    render: (item) => item.partialityNumber ?? "—",
                  },
                  {
                    id: "previous",
                    header: "Saldo anterior",
                    numeric: true,
                    render: (item) =>
                      formatExactMoney(item.previousBalance, item.currency),
                  },
                  {
                    id: "paid",
                    header: "Pagado",
                    numeric: true,
                    render: (item) =>
                      formatExactMoney(item.paidAmount, item.currency),
                  },
                  {
                    id: "outstanding",
                    header: "Saldo insoluto",
                    numeric: true,
                    render: (item) =>
                      formatExactMoney(item.outstandingBalance, item.currency),
                  },
                ]}
              />
            </section>
          ))}
        </div>
      ) : (
        <p className="p-5 text-body-sm text-muted-foreground">
          Este CFDI no contiene complemento de Pagos 2.0.
        </p>
      )}
    </Surface>
  );
}

function Payroll({ cfdi }: { cfdi: CfdiDetail }) {
  return (
    <Surface>
      <SurfaceHeader title="Nómina" description="Datos core de Nómina 1.2." />
      {cfdi.payroll ? (
        <div className="space-y-6 p-5">
          <DefinitionGrid
            items={[
              {
                label: "Versión de nómina",
                value: cfdi.payroll.payrollVersion || "—",
              },
              {
                label: "Tipo de nómina",
                value: cfdi.payroll.payrollType || "—",
              },
              {
                label: "Fecha de pago",
                value: dateTime(cfdi.payroll.paymentDate),
              },
              {
                label: "Período pagado",
                value: `${cfdi.payroll.initialPaymentDate} – ${cfdi.payroll.finalPaymentDate}`,
              },
              {
                label: "Días pagados",
                value: formatExactDecimal(cfdi.payroll.daysPaid),
              },
              { label: "RFC del receptor", value: cfdi.receiverRfc || "—" },
              {
                label: "CURP empleado",
                value: cfdi.payroll.employeeCurp ?? "—",
              },
              {
                label: "Número de empleado",
                value: cfdi.payroll.employeeNumber ?? "—",
              },
              {
                label: "Registro patronal",
                value: cfdi.payroll.employerRegistration ?? "—",
              },
              {
                label: "Régimen / contrato",
                value:
                  [cfdi.payroll.regimeType, cfdi.payroll.contractType]
                    .filter(Boolean)
                    .join(" · ") || "—",
              },
              {
                label: "Periodicidad",
                value: cfdi.payroll.paymentPeriodicity ?? "—",
              },
              {
                label: "Percepciones",
                value: formatExactMoney(
                  cfdi.payroll.totalPerceptions,
                  cfdi.currency,
                ),
              },
              {
                label: "Deducciones",
                value: formatExactMoney(
                  cfdi.payroll.totalDeductions,
                  cfdi.currency,
                ),
              },
              {
                label: "Otros pagos",
                value: formatExactMoney(
                  cfdi.payroll.totalOtherPayments,
                  cfdi.currency,
                ),
              },
            ]}
          />
          <ProductTable
            caption="Percepciones de nómina"
            rows={cfdi.payroll.perceptions}
            rowKey={(item) => `perception-${item.ordinal}`}
            emptyMessage="No hay percepciones registradas."
            columns={[
              { id: "type", header: "Tipo", render: (item) => item.type },
              { id: "key", header: "Clave", render: (item) => item.key },
              {
                id: "concept",
                header: "Concepto",
                render: (item) => item.concept,
              },
              {
                id: "taxable",
                header: "Gravado",
                numeric: true,
                render: (item) =>
                  formatExactMoney(item.taxableAmount, cfdi.currency),
              },
              {
                id: "exempt",
                header: "Exento",
                numeric: true,
                render: (item) =>
                  formatExactMoney(item.exemptAmount, cfdi.currency),
              },
            ]}
          />
          <ProductTable
            caption="Deducciones de nómina"
            rows={cfdi.payroll.deductions}
            rowKey={(item) => `deduction-${item.ordinal}`}
            emptyMessage="No hay deducciones registradas."
            columns={[
              { id: "type", header: "Tipo", render: (item) => item.type },
              { id: "key", header: "Clave", render: (item) => item.key },
              {
                id: "concept",
                header: "Concepto",
                render: (item) => item.concept,
              },
              {
                id: "amount",
                header: "Importe",
                numeric: true,
                render: (item) => formatExactMoney(item.amount, cfdi.currency),
              },
            ]}
          />
          <ProductTable
            caption="Otros pagos de nómina"
            rows={cfdi.payroll.otherPayments}
            rowKey={(item) => `other-payment-${item.ordinal}`}
            emptyMessage="No hay otros pagos registrados."
            columns={[
              { id: "type", header: "Tipo", render: (item) => item.type },
              { id: "key", header: "Clave", render: (item) => item.key },
              {
                id: "concept",
                header: "Concepto",
                render: (item) => item.concept,
              },
              {
                id: "amount",
                header: "Importe",
                numeric: true,
                render: (item) => formatExactMoney(item.amount, cfdi.currency),
              },
            ]}
          />
          <ProductTable
            caption="Incapacidades de nómina"
            rows={cfdi.payroll.incapacities}
            rowKey={(item) => `incapacity-${item.ordinal}`}
            emptyMessage="No hay incapacidades registradas."
            columns={[
              { id: "type", header: "Tipo", render: (item) => item.type },
              {
                id: "days",
                header: "Días",
                numeric: true,
                render: (item) => formatExactDecimal(item.days),
              },
              {
                id: "amount",
                header: "Importe",
                numeric: true,
                render: (item) => formatExactMoney(item.amount, cfdi.currency),
              },
            ]}
          />
        </div>
      ) : (
        <p className="p-5 text-body-sm text-muted-foreground">
          Este CFDI no contiene complemento de Nómina 1.2.
        </p>
      )}
    </Surface>
  );
}

function Traceability({ cfdi }: { cfdi: CfdiDetail }) {
  return (
    <div className="space-y-6">
      <Surface>
        <SurfaceHeader
          title="Origen"
          description="Procedencia durable y versiones de interpretación."
        />
        <ProductTable
          caption="Observaciones de procedencia del CFDI"
          rows={cfdi.provenance}
          rowKey={(item) => item.id}
          emptyMessage="No hay observaciones de procedencia disponibles."
          columns={[
            {
              id: "observed",
              header: "Observado",
              render: (item) => dateTime(item.observedAt),
            },
            {
              id: "result",
              header: "Resultado",
              render: (item) => item.result ?? "—",
            },
            {
              id: "parser",
              header: "Parser",
              render: (item) => item.parserVersion ?? "—",
            },
            {
              id: "schema",
              header: "Esquema",
              render: (item) => item.schemaVersion ?? "—",
            },
            {
              id: "job",
              header: "Proceso",
              render: (item) => (
                <span className="identifier break-all">
                  {item.jobId ?? "—"}
                </span>
              ),
            },
          ]}
        />
      </Surface>
      <Surface>
        <SurfaceHeader
          title="Participación en períodos"
          description="Asignación versionada por fecha fuente y zona horaria."
        />
        <ProductTable
          caption="Períodos fiscales en los que participa el CFDI"
          rows={cfdi.periods}
          rowKey={(period) =>
            period.id ||
            `${period.year}-${period.month}-${period.participationType}-${period.sourceDate}`
          }
          emptyMessage="No hay participación en un ejercicio configurado. Revisa las incidencias."
          columns={[
            {
              id: "period",
              header: "Período",
              render: (item) =>
                `${monthNames[item.month - 1] ?? item.month} ${item.year}`,
            },
            {
              id: "type",
              header: "Participación",
              render: (item) => item.participationType,
            },
            {
              id: "source",
              header: "Fecha fuente",
              render: (item) => dateTime(item.sourceDate),
            },
            {
              id: "timezone",
              header: "Zona horaria",
              render: (item) => item.timezone,
            },
            {
              id: "policy",
              header: "Política",
              render: (item) => `${item.policyVersion} · ${item.origin}`,
            },
          ]}
        />
      </Surface>
      <PermissionBoundary capability="incidents.view">
        <Surface>
          <SurfaceHeader
            title="Incidencias"
            description="Alertas generadas durante la incorporación y clasificación."
          />
          <ProductTable
            caption="Incidencias relacionadas con el CFDI"
            rows={cfdi.incidents}
            rowKey={(incident) => incident.id}
            emptyMessage="No hay incidencias registradas para este CFDI."
            columns={[
              {
                id: "code",
                header: "Código",
                render: (item) => (
                  <span className="identifier">{item.code}</span>
                ),
              },
              {
                id: "severity",
                header: "Severidad",
                render: (item) => <StatusBadge status={item.severity} />,
              },
              {
                id: "status",
                header: "Estado",
                render: (item) => <StatusBadge status={item.status} />,
              },
              {
                id: "detail",
                header: "Detalle",
                render: (item) => item.safeDetail ?? "—",
              },
              {
                id: "created",
                header: "Creada",
                render: (item) => dateTime(item.createdAt),
              },
            ]}
          />
        </Surface>
      </PermissionBoundary>
    </div>
  );
}

function taxScopeLabel(scope: CfdiDetail["taxes"][number]["scope"]) {
  if (scope === "concept") return "Concepto";
  if (scope === "payment") return "Pago";
  if (scope === "payment_document") return "Documento de pago";
  return "Comprobante";
}
