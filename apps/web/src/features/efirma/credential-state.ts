export interface CustodyState {
  id: string;
  legalEntityId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  localValidation: string;
  revocationStatus: "unknown";
  synthetic: boolean;
  errorCode: string | null;
  cleanup: string;
}
export const activeCustody = (state: CustodyState, now = Date.now()) =>
  ["preparing", "ready", "claimed", "unwrapping"].includes(state.status) &&
  Date.parse(state.expiresAt) > now;
export function credentialFileError(
  file: Pick<File, "name" | "size"> | undefined,
  extension: ".cer" | ".key",
) {
  return !file ||
    !file.name.toLowerCase().endsWith(extension) ||
    file.size < 1 ||
    file.size > 16384
    ? `Selecciona un archivo ${extension} de hasta 16 KiB.`
    : null;
}
export function recoveryIds(query: URLSearchParams) {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const entityId = query.get("entityId");
  const custodyId = query.get("custodyId");
  return {
    entityId: entityId && uuid.test(entityId) ? entityId : null,
    custodyId: custodyId && uuid.test(custodyId) ? custodyId : null,
  };
}
export const custodyLabels: Record<string, string> = {
  preparing: "Validando y preparando",
  ready: "Disponible temporalmente",
  claimed: "Uso interno reservado",
  unwrapping: "Consumo en curso",
  consumed: "Consumida",
  revoked: "Revocada",
  expired: "Expirada",
  failed: "Falló la preparación",
  requires_user_authorization: "Requiere una nueva autorización",
};
