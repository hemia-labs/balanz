import { HttpException, HttpStatus } from '@nestjs/common';

const CLIENT_DOMAIN_MESSAGES: Record<string, string> = {
  ACCOUNT_ASSIGNMENT_CONFLICT:
    'Este integrante ya tiene una asignación activa en la cuenta.',
  ACCOUNT_ASSIGNMENT_NOT_FOUND: 'La asignación ya no está disponible.',
  ACTIVE_TENANT_REQUIRED: 'Selecciona una organización activa para continuar.',
  ARCHIVED_ACCESS_FORBIDDEN:
    'No tienes permiso para consultar elementos archivados.',
  CLIENT_ACCOUNT_CODE_CONFLICT: 'Ya existe un cliente activo con este código.',
  CLIENT_ACCOUNT_NOT_FOUND: 'El cliente no existe o ya no tienes acceso.',
  FISCAL_YEAR_CONFLICT:
    'Este ejercicio fiscal ya existe para la entidad seleccionada.',
  FISCAL_YEAR_NOT_FOUND: 'El ejercicio fiscal ya no está disponible.',
  INVALID_CLIENT_SORT: 'El orden seleccionado no es válido.',
  INVALID_FISCAL_YEAR: 'Selecciona un ejercicio entre 2000 y el próximo año.',
  LAST_ACTIVE_LEGAL_ENTITY:
    'No puedes archivar el último RFC activo del cliente.',
  LAST_PRIMARY_ASSIGNMENT:
    'Asigna primero un nuevo responsable principal antes de retirar el actual.',
  LEGAL_ENTITY_NOT_FOUND: 'La entidad fiscal no existe o ya no tienes acceso.',
  LEGAL_ENTITY_RFC_CONFLICT:
    'Este RFC ya está activo dentro de la organización.',
  MEMBERSHIP_NOT_ELIGIBLE:
    'El integrante seleccionado no puede ser responsable principal.',
  PRIMARY_ASSIGNMENT_CONFLICT:
    'La cuenta ya tiene un responsable principal activo.',
  STALE_CLIENT_ACCOUNT:
    'La cuenta cambió mientras la editabas. Recarga e intenta de nuevo.',
  STALE_LEGAL_ENTITY:
    'La entidad fiscal cambió mientras la editabas. Recarga e intenta de nuevo.',
};

export function domainError(
  status: HttpStatus,
  code: string,
  message: string,
): HttpException {
  return new HttpException(
    { code, message: CLIENT_DOMAIN_MESSAGES[code] ?? message, error: code },
    status,
  );
}

export function constraintName(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' ? constraint : null;
}
