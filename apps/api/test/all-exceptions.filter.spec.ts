import { BadRequestException } from '@nestjs/common';
import { captureException } from '@hemia/horus';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

jest.mock('@hemia/horus', () => ({
  captureException: jest.fn(),
}));

describe('AllExceptionsFilter', () => {
  beforeEach(() => {
    jest.mocked(captureException).mockClear();
  });

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
    expect(captureException).not.toHaveBeenCalled();
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

  it('captura los errores 5xx sin enviar la query y conserva traceparent', () => {
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const exception = new Error('unexpected failure');
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'GET',
          url: '/api/v1/client-accounts?search=cliente-confidencial',
          path: '/api/v1/client-accounts',
          headers: {
            traceparent:
              '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          },
          correlationId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      }),
    } as never;

    new AllExceptionsFilter().catch(exception, host);

    expect(captureException).toHaveBeenCalledWith(exception, {
      request: { method: 'GET', url: '/api/v1/client-accounts' },
      trace_id: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    expect(response.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/v1/client-accounts?search=cliente-confidencial',
      }),
    );
  });
});
