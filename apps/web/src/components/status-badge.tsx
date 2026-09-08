import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Circle,
  Clock3,
  LockKeyhole,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const statusMap = {
  "Sin iniciar": {
    variant: "outline",
    icon: Circle,
    labels: { es: "Sin iniciar", en: "Not started" },
  },
  "En preparación": {
    variant: "info",
    icon: Clock3,
    labels: { es: "En preparación", en: "In preparation" },
  },
  "En proceso": {
    variant: "info",
    icon: Clock3,
    labels: { es: "En proceso", en: "In progress" },
  },
  "En revisión": {
    variant: "warning",
    icon: Clock3,
    labels: { es: "En revisión", en: "Under review" },
  },
  "Listo para cerrar": {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Listo para cerrar", en: "Ready to close" },
  },
  Cerrado: {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Cerrado", en: "Closed" },
  },
  Completado: {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Completado", en: "Completed" },
  },
  "Con novedades": {
    variant: "warning",
    icon: AlertCircle,
    labels: { es: "Con novedades", en: "Updates found" },
  },
  "Cambios detectados": {
    variant: "warning",
    icon: AlertCircle,
    labels: { es: "Cambios detectados", en: "Changes detected" },
  },
  "Con errores": {
    variant: "destructive",
    icon: AlertCircle,
    labels: { es: "Con errores", en: "With errors" },
  },
  "Con observaciones": {
    variant: "warning",
    icon: AlertCircle,
    labels: { es: "Con observaciones", en: "With observations" },
  },
  Reabierto: {
    variant: "info",
    icon: RotateCcw,
    labels: { es: "Reabierto", en: "Reopened" },
  },
  Bloqueado: {
    variant: "destructive",
    icon: LockKeyhole,
    labels: { es: "Bloqueado", en: "Blocked" },
  },
  Pendiente: {
    variant: "warning",
    icon: Clock3,
    labels: { es: "Pendiente", en: "Pending" },
  },
  Revisado: {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Revisado", en: "Reviewed" },
  },
  Cancelado: {
    variant: "destructive",
    icon: AlertCircle,
    labels: { es: "Cancelado", en: "Cancelled" },
  },
  "Con incidencia": {
    variant: "destructive",
    icon: AlertCircle,
    labels: { es: "Con incidencia", en: "Issue found" },
  },
  Vigente: {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Vigente", en: "Current" },
  },
  "Próxima a vencer": {
    variant: "warning",
    icon: AlertCircle,
    labels: { es: "Próxima a vencer", en: "Expiring soon" },
  },
  Vencida: {
    variant: "destructive",
    icon: AlertCircle,
    labels: { es: "Vencida", en: "Expired" },
  },
  Conectado: {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Conectado", en: "Connected" },
  },
  "Requiere atención": {
    variant: "warning",
    icon: AlertCircle,
    labels: { es: "Requiere atención", en: "Needs attention" },
  },
  "Sin configurar": {
    variant: "outline",
    icon: Circle,
    labels: { es: "Sin configurar", en: "Not configured" },
  },
  Generada: {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Generada", en: "Generated" },
  },
  Desactualizada: {
    variant: "warning",
    icon: AlertCircle,
    labels: { es: "Desactualizada", en: "Out of date" },
  },
  Activo: {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Activo", en: "Active" },
  },
  Permitido: {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Permitido", en: "Allowed" },
  },
  Denegado: {
    variant: "destructive",
    icon: LockKeyhole,
    labels: { es: "Denegado", en: "Denied" },
  },
  Aceptada: {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Aceptada", en: "Accepted" },
  },
  Suspendido: {
    variant: "warning",
    icon: AlertCircle,
    labels: { es: "Suspendido", en: "Suspended" },
  },
  Archivado: {
    variant: "outline",
    icon: Archive,
    labels: { es: "Archivado", en: "Archived" },
  },
  Revocado: {
    variant: "destructive",
    icon: LockKeyhole,
    labels: { es: "Revocado", en: "Revoked" },
  },
  Revocada: {
    variant: "destructive",
    icon: AlertCircle,
    labels: { es: "Revocada", en: "Revoked" },
  },
  Expirada: {
    variant: "warning",
    icon: AlertCircle,
    labels: { es: "Expirada", en: "Expired" },
  },
  "Invitación pendiente": {
    variant: "warning",
    icon: Clock3,
    labels: { es: "Invitación pendiente", en: "Invitation pending" },
  },
  Bloqueante: {
    variant: "destructive",
    icon: LockKeyhole,
    labels: { es: "Bloqueante", en: "Blocking" },
  },
  Advertencia: {
    variant: "warning",
    icon: AlertCircle,
    labels: { es: "Advertencia", en: "Warning" },
  },
  Información: {
    variant: "info",
    icon: AlertCircle,
    labels: { es: "Información", en: "Information" },
  },
  Completo: {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Completo", en: "Complete" },
  },
  "No aplica": {
    variant: "outline",
    icon: Circle,
    labels: { es: "No aplica", en: "Not applicable" },
  },
  Excluido: {
    variant: "outline",
    icon: Circle,
    labels: { es: "Excluido", en: "Excluded" },
  },
  Preparado: {
    variant: "info",
    icon: Clock3,
    labels: { es: "Preparado", en: "Prepared" },
  },
  Descartado: {
    variant: "outline",
    icon: Circle,
    labels: { es: "Descartado", en: "Dismissed" },
  },
  Incorporado: {
    variant: "success",
    icon: CheckCircle2,
    labels: { es: "Incorporado", en: "Incorporated" },
  },
  Duplicado: {
    variant: "info",
    icon: CheckCircle2,
    labels: { es: "Duplicado", en: "Duplicate" },
  },
  Ajeno: {
    variant: "warning",
    icon: AlertCircle,
    labels: { es: "RFC ajeno", en: "Foreign RFC" },
  },
  "No soportado": {
    variant: "warning",
    icon: AlertCircle,
    labels: { es: "No soportado", en: "Unsupported" },
  },
  Inválido: {
    variant: "destructive",
    icon: AlertCircle,
    labels: { es: "Inválido", en: "Invalid" },
  },
  "Cancelación solicitada": {
    variant: "warning",
    icon: Clock3,
    labels: { es: "Cancelación solicitada", en: "Cancellation requested" },
  },
} as const;

const apiStatusAliases: Record<string, keyof typeof statusMap> = {
  active: "Activo",
  suspended: "Suspendido",
  archived: "Archivado",
  revoked: "Revocado",
  not_started: "Sin iniciar",
  preparation: "En preparación",
  review: "En revisión",
  ready_to_close: "Listo para cerrar",
  closed: "Cerrado",
  completed: "Completado",
  awaiting_upload: "Pendiente",
  queued: "En preparación",
  processing: "En proceso",
  completed_with_issues: "Con observaciones",
  failed_retryable: "Con errores",
  failed_final: "Con errores",
  cancel_requested: "Cancelación solicitada",
  incorporated: "Incorporado",
  duplicate: "Duplicado",
  foreign: "Ajeno",
  unsupported: "No soportado",
  invalid: "Inválido",
  internal_error: "Con errores",
  high: "Bloqueante",
  critical: "Bloqueante",
  medium: "Advertencia",
  low: "Información",
  open: "Pendiente",
  resolved: "Completado",
  dismissed: "Descartado",
  changes_detected: "Cambios detectados",
  reopened: "Reabierto",
  blocked: "Bloqueado",
  pending: "Pendiente",
  cancelled: "Cancelado",
  canceled: "Cancelado",
};

function humanizeStatus(status: string) {
  const normalized = status.trim().replaceAll(/[_-]+/g, " ");
  return normalized
    ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1).toLowerCase()}`
    : "—";
}

export function StatusBadge({
  status,
  locale = "es",
}: {
  status: string;
  locale?: string;
}) {
  const statusKey = apiStatusAliases[status.toLowerCase()] ?? status;
  const config = statusMap[statusKey as keyof typeof statusMap];
  const language = locale.toLowerCase().startsWith("en") ? "en" : "es";
  const Icon = config?.icon ?? Circle;
  const label = config?.labels[language] ?? humanizeStatus(status);
  return (
    <Badge variant={config?.variant ?? "outline"}>
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}
