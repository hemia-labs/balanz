import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock3,
  LockKeyhole,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const statusMap = {
  "Sin iniciar": { variant: "outline", icon: Circle },
  "En preparación": { variant: "info", icon: Clock3 },
  "En proceso": { variant: "info", icon: Clock3 },
  "En revisión": { variant: "warning", icon: Clock3 },
  "Listo para cerrar": { variant: "success", icon: CheckCircle2 },
  Cerrado: { variant: "success", icon: CheckCircle2 },
  Completado: { variant: "success", icon: CheckCircle2 },
  "Con novedades": { variant: "warning", icon: AlertCircle },
  "Con errores": { variant: "destructive", icon: AlertCircle },
  "Con observaciones": { variant: "warning", icon: AlertCircle },
  Reabierto: { variant: "info", icon: RotateCcw },
  Bloqueado: { variant: "destructive", icon: LockKeyhole },
  Pendiente: { variant: "warning", icon: Clock3 },
  Revisado: { variant: "success", icon: CheckCircle2 },
  Cancelado: { variant: "destructive", icon: AlertCircle },
  "Con incidencia": { variant: "destructive", icon: AlertCircle },
  Vigente: { variant: "success", icon: CheckCircle2 },
  "Próxima a vencer": { variant: "warning", icon: AlertCircle },
  Vencida: { variant: "destructive", icon: AlertCircle },
  Conectado: { variant: "success", icon: CheckCircle2 },
  "Requiere atención": { variant: "warning", icon: AlertCircle },
  "Sin configurar": { variant: "outline", icon: Circle },
  Generada: { variant: "success", icon: CheckCircle2 },
  Desactualizada: { variant: "warning", icon: AlertCircle },
  Activo: { variant: "success", icon: CheckCircle2 },
  Permitido: { variant: "success", icon: CheckCircle2 },
  Denegado: { variant: "destructive", icon: LockKeyhole },
  Aceptada: { variant: "success", icon: CheckCircle2 },
  Suspendido: { variant: "destructive", icon: LockKeyhole },
  Revocado: { variant: "destructive", icon: AlertCircle },
  Revocada: { variant: "destructive", icon: AlertCircle },
  Expirada: { variant: "warning", icon: AlertCircle },
  "Invitación pendiente": { variant: "warning", icon: Clock3 },
  Bloqueante: { variant: "destructive", icon: LockKeyhole },
  Advertencia: { variant: "warning", icon: AlertCircle },
  Información: { variant: "info", icon: AlertCircle },
  Completo: { variant: "success", icon: CheckCircle2 },
  "No aplica": { variant: "outline", icon: Circle },
  Excluido: { variant: "outline", icon: Circle },
  Preparado: { variant: "info", icon: Clock3 },
} as const;

export function StatusBadge({ status }: { status: string }) {
  const config = statusMap[status as keyof typeof statusMap] ?? {
    variant: "outline" as const,
    icon: Circle,
  };
  const Icon = config.icon;
  return (
    <Badge variant={config.variant}>
      <Icon className="size-3" aria-hidden="true" />
      {status}
    </Badge>
  );
}
