import { HttpStatus } from '@nestjs/common';
import { RoleKey } from '../permissions/entities/role.entity';
import { domainError } from './client-domain.errors';
import { ClientAccountSort } from './dtos/client-account.dtos';

const CLIENT_SORT_COLUMNS: Record<ClientAccountSort, string> = {
  [ClientAccountSort.NAME]: 'account.name',
  [ClientAccountSort.STATUS]: 'account.status',
  [ClientAccountSort.UPDATED_AT]: 'account.updated_at',
};

export function clientSortColumn(sort: string): string {
  if (!Object.prototype.hasOwnProperty.call(CLIENT_SORT_COLUMNS, sort)) {
    throw domainError(
      HttpStatus.BAD_REQUEST,
      'INVALID_CLIENT_SORT',
      'Unsupported client account sort',
    );
  }
  return CLIENT_SORT_COLUMNS[sort as ClientAccountSort];
}

export function validateFiscalYear(
  year: number,
  currentYear = new Date().getFullYear(),
): void {
  if (year < 2000 || year > currentYear + 1) {
    throw domainError(
      HttpStatus.BAD_REQUEST,
      'INVALID_FISCAL_YEAR',
      'Fiscal year must be between 2000 and next year',
    );
  }
}

export function isEligiblePrimaryRole(role: RoleKey): boolean {
  return role === RoleKey.ADMIN || role === RoleKey.ACCOUNTANT;
}
