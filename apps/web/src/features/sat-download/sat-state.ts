export const satLabels: Record<string, string> = {
  authorization_pending: "Autoriza la solicitud",
  submitting: "Enviando solicitud",
  waiting_sat:
    "SAT está procesando. Necesitamos tu autorización para consultar de nuevo.",
  requires_user_authorization:
    "Necesitamos una nueva autorización para continuar.",
  recovering: "Recuperando paquetes",
  processing_local: "Procesando archivos recuperados",
  completed: "Proceso completado",
  completed_with_issues: "Proceso terminado con incidencias",
  cancelled: "Cancelado en Hemia",
  failed: "No se pudo completar",
  external_submission_unknown:
    "SAT pudo recibir la solicitud, pero no recibimos su folio. No se enviará otra automáticamente.",
};
export const pollSat = (status: string) =>
  ["submitting", "recovering", "processing_local"].includes(status);
export const canAuthorizeSat = (status: string) =>
  [
    "authorization_pending",
    "requires_user_authorization",
    "waiting_sat",
  ].includes(status);
export function satRecovery(query: URLSearchParams) {
  const id = query.get("satJob");
  return id &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}
export interface SatProcess {
  id: string;
  legalEntityId: string;
  status: string;
  errorCode: string | null;
  contentType: "xml" | "metadata";
  counters?: {
    total: number;
    retrieved: number;
    processed: number;
    incorporated: number;
    issues: number;
    metadataObservations?: number;
  };
  request?: { external_id: string | null; sat_state: number | null };
}
export interface SatPackage {
  id: string;
  ordinal: number;
  external_id: string;
  status: string;
  error_code: string | null;
  download_attempts: number;
  uncertain_attempts: number;
  ingestion_job_id: string | null;
}
