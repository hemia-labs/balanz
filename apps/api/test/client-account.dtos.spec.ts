import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { API_VALIDATION_PIPE_OPTIONS } from '../src/common/validation/validation-exception.factory';
import { CreateClientAccountDto } from '../src/modules/client-accounts/dtos/client-account.dtos';
import {
  clientSortColumn,
  isEligiblePrimaryRole,
  validateFiscalYear,
} from '../src/modules/client-accounts/client-domain.rules';
import {
  RoleKey,
  RoleScope,
} from '../src/modules/permissions/entities/role.entity';

const pipe = new ValidationPipe(API_VALIDATION_PIPE_OPTIONS);

async function transform(
  body: Record<string, unknown>,
): Promise<CreateClientAccountDto> {
  const result: unknown = await pipe.transform(body, {
    type: 'body',
    metatype: CreateClientAccountDto,
  });
  return result as CreateClientAccountDto;
}

describe('Client account input rules', () => {
  it('trims names, normalizes RFC and transforms the fiscal year', async () => {
    const dto = await transform({
      accountName: '  Empresa Uno  ',
      legalEntity: {
        legalName: '  Empresa Uno SA de CV  ',
        rfc: '  abc010101aa1 ',
      },
      primaryMembershipId: '550e8400-e29b-41d4-a716-446655440000',
      fiscalYear: '2026',
    });

    expect(dto.accountName).toBe('Empresa Uno');
    expect(dto.fiscalYear).toBe(2026);
    expect(dto.legalEntity.legalName).toBe('Empresa Uno SA de CV');
    expect(dto.legalEntity.rfc).toBe('ABC010101AA1');
  });

  it('rejects an invalid RFC and server-owned extra fields', async () => {
    const invalidRfc = transform({
      accountName: 'Empresa',
      legalEntity: { legalName: 'Empresa', rfc: 'not-rfc' },
      primaryMembershipId: '550e8400-e29b-41d4-a716-446655440000',
      fiscalYear: 2026,
    });
    await expect(invalidRfc).rejects.toBeInstanceOf(BadRequestException);
    await expect(invalidRfc).rejects.toMatchObject({
      response: {
        code: 'VALIDATION_ERROR',
        message: 'Revisa los campos señalados e intenta de nuevo.',
        fieldErrors: {
          'legalEntity.rfc': [
            'Ingresa un RFC válido de 12 o 13 caracteres, sin espacios ni guiones.',
          ],
        },
      },
    });

    await expect(
      transform({
        accountName: 'Empresa',
        legalEntity: { legalName: 'Empresa', rfc: 'ABC010101AA1' },
        primaryMembershipId: '550e8400-e29b-41d4-a716-446655440000',
        fiscalYear: 2026,
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'VALIDATION_ERROR',
        fieldErrors: {
          organizationId: ['Este campo no está permitido.'],
        },
      },
    });
  });

  it('uses a fixed sort allowlist with a stable error code', () => {
    expect(clientSortColumn('updatedAt')).toBe('account.updated_at');
    try {
      clientSortColumn('name; drop table client_accounts');
      throw new Error('expected sort validation to fail');
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({ code: 'INVALID_CLIENT_SORT' }),
      );
    }
  });

  it('enforces the dynamic fiscal-year range', () => {
    expect(() => validateFiscalYear(2000, 2026)).not.toThrow();
    expect(() => validateFiscalYear(2027, 2026)).not.toThrow();
    expect(() => validateFiscalYear(1999, 2026)).toThrow(
      'Selecciona un ejercicio entre 2000 y el próximo año.',
    );
    expect(() => validateFiscalYear(2028, 2026)).toThrow(
      'Selecciona un ejercicio entre 2000 y el próximo año.',
    );
  });

  it('only allows owner or accountant organization memberships as primary', () => {
    expect(isEligiblePrimaryRole(RoleKey.OWNER, RoleScope.ORGANIZATION)).toBe(
      true,
    );
    expect(
      isEligiblePrimaryRole(RoleKey.ACCOUNTANT, RoleScope.ORGANIZATION),
    ).toBe(true);
    expect(
      isEligiblePrimaryRole(RoleKey.COLLABORATOR, RoleScope.ORGANIZATION),
    ).toBe(false);
    expect(isEligiblePrimaryRole(RoleKey.ADMIN, RoleScope.PLATFORM)).toBe(
      false,
    );
  });
});
