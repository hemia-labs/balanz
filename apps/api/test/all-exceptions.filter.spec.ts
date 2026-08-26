import { BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  it('conserva el código funcional de un error HTTP', () => {
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          url: '/api/v1/auth/mfa/totp/verify',
          correlationId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      }),
    } as never;

    new AllExceptionsFilter().catch(
      new BadRequestException({
        code: 'MFA_INVALID_CODE',
        message: 'El código MFA no es válido o ha expirado.',
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'MFA_INVALID_CODE',
        message: 'El código MFA no es válido o ha expirado.',
      }),
    );
  });

  it('conserva errores de campo seguros', () => {
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          url: '/api/v1/client-accounts',
          correlationId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      }),
    } as never;

    new AllExceptionsFilter().catch(
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Revisa los campos señalados e intenta de nuevo.',
        fieldErrors: {
          'legalEntity.rfc': ['Ingresa un RFC válido.'],
          unsafe: 'not-an-array',
        },
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldErrors: {
          'legalEntity.rfc': ['Ingresa un RFC válido.'],
        },
      }),
    );
  });
});
