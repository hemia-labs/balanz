import { apiErrorMessage, isApiError } from "@/lib/api-client";

export function teamErrorMessage(cause: unknown, fallback: string) {
  if (!isApiError(cause)) return fallback;
  if (cause.code === "REAUTHENTICATION_REQUIRED") {
    return apiErrorMessage(cause, fallback);
  }
  switch (cause.status) {
    case 401:
      return "La sesión o invitación ya no es válida. Inicia de nuevo el flujo.";
    case 403:
      return "No tienes permiso para administrar este equipo.";
    case 404:
      return "El recurso ya no está disponible en la organización activa.";
    case 409:
      return "La información cambió o ya existe un registro activo. Actualiza la lista e intenta de nuevo.";
    case 422:
      return "El estado o los datos actuales no permiten completar esta operación.";
    case 429:
      return "Ya realizaste demasiadas solicitudes. Intenta más tarde.";
    default:
      return apiErrorMessage(cause, fallback);
  }
}
