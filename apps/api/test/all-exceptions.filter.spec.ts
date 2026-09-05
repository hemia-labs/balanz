import {
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { captureException } from '@hemia/horus';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

jest.mock('@hemia/horus', () => ({
  captureException: jest.fn(),
}));

describe('AllExceptionsFilter', () => {
  beforeEach(() => {
    jest.mocked(captureException).mockClear();
    jest.mocked(captureException).mockResolvedValue(undefined);
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

  it('deriva un código estable sólo cuando el mensaje simple está allowlisted', () => {
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'POST',
          path: '/api/v1/cfdis/id/access-url',
          correlationId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      }),
    } as never;

    new AllExceptionsFilter().catch(
      new UnauthorizedException('MFA_REQUIRED'),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MFA_REQUIRED' }),
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

  it('captura un error 5xx canónico sin enviar query, SQL, stack ni secretos', async () => {
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const secretCanary = 'secret-canary-should-never-escape';
    const sqlCanary = 'SELECT private_value FROM fiscal_secret_table';
    const stackCanary = 'stack-canary-should-never-escape';
    const exception = new InternalServerErrorException({
      message: `${secretCanary}; ${sqlCanary}`,
      error: 'private-error-canary',
    });
    exception.stack = `${stackCanary}\n${exception.message}`;
    const filter = new AllExceptionsFilter();
    const loggerError = jest.fn();
    Object.defineProperty(filter, 'logger', {
      value: { error: loggerError },
    });
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

    filter.catch(exception, host);
    await Promise.resolve();

    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      request: { method: 'GET', url: '/api/v1/client-accounts' },
      trace_id: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      tags: {
        correlation_id: '550e8400-e29b-41d4-a716-446655440000',
      },
    });
    const captured = jest.mocked(captureException).mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured).not.toBe(exception);
    expect((captured as Error).name).toBe('UnhandledInternalServerError');
    expect((captured as Error).message).toBe('UNHANDLED_INTERNAL_SERVER_ERROR');
    expect((captured as Error).stack).not.toContain(secretCanary);
    expect((captured as Error).stack).not.toContain(sqlCanary);
    expect((captured as Error).stack).not.toContain(stackCanary);
    expect((captured as Error & { cause?: unknown }).cause).toBeUndefined();
    const logged = JSON.stringify(loggerError.mock.calls);
    for (const canary of [secretCanary, sqlCanary, stackCanary]) {
      expect(logged).not.toContain(canary);
    }
    expect(loggerError).toHaveBeenCalledWith({
      event: 'unhandled_internal_server_error',
      code: 'UNHANDLED_INTERNAL_SERVER_ERROR',
      statusCode: 500,
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
      method: 'GET',
      path: '/api/v1/client-accounts',
    });
    expect(response.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/v1/client-accounts',
        message: 'Ocurrió un error inesperado. Intenta de nuevo.',
      }),
    );
    const responsePayload = JSON.stringify(
      (json.mock.calls as unknown[][])[0]?.[0],
    );
    expect(responsePayload).not.toContain(secretCanary);
    expect(responsePayload).not.toContain(sqlCanary);
    expect(responsePayload).not.toContain('private-error-canary');
  });

  it('preserva sólo el código fiscal allowlisted de un 503 redactado', () => {
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const filter = new AllExceptionsFilter();
    Object.defineProperty(filter, 'logger', {
      value: { error: jest.fn() },
    });
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'POST',
          path: '/api/v1/legal-entities/id/ingestions/xml',
          headers: {},
          correlationId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      }),
    } as never;

    filter.catch(
      new ServiceUnavailableException({
        code: 'OBJECT_STORAGE_UNAVAILABLE',
        message: 'private-storage-host-canary',
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'OBJECT_STORAGE_UNAVAILABLE',
        message: 'Ocurrió un error inesperado. Intenta de nuevo.',
      }),
    );
    expect(JSON.stringify(json.mock.calls)).not.toContain(
      'private-storage-host-canary',
    );
  });

  it('rechaza metadata no allowlisted antes de logs y telemetría', async () => {
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const filter = new AllExceptionsFilter();
    const loggerError = jest.fn();
    Object.defineProperty(filter, 'logger', {
      value: { error: loggerError },
    });
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'GET\r\nsecret-header',
          url: '/safe?secret=query-canary',
          path: '/safe?secret=query-canary',
          headers: { traceparent: 'trace-canary-invalid' },
          correlationId: 'correlation-canary-invalid',
        }),
      }),
    } as never;

    filter.catch(new Error('private failure'), host);
    await Promise.resolve();

    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      request: { method: 'UNKNOWN', url: '/' },
      tags: { correlation_id: 'unavailable' },
    });
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'unavailable',
        method: 'UNKNOWN',
        path: '/',
      }),
    );
    const serialized = JSON.stringify([
      jest.mocked(captureException).mock.calls,
      loggerError.mock.calls,
    ]);
    expect(serialized).not.toContain('query-canary');
    expect(serialized).not.toContain('trace-canary');
    expect(serialized).not.toContain('correlation-canary');
  });

  it('conserva la respuesta canónica si telemetría lanza síncronamente', async () => {
    const telemetryCanary = 'telemetry-sync-secret-canary';
    jest.mocked(captureException).mockImplementationOnce(() => {
      throw new Error(telemetryCanary);
    });
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const filter = new AllExceptionsFilter();
    const loggerError = jest.fn();
    Object.defineProperty(filter, 'logger', {
      value: { error: loggerError },
    });
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'POST',
          url: '/api/v1/safe?secret=value',
          path: '/api/v1/safe',
          headers: {},
          correlationId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      }),
    } as never;

    expect(() => filter.catch(new Error('private'), host)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(response.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Ocurrió un error inesperado. Intenta de nuevo.',
        path: '/api/v1/safe',
      }),
    );
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(
      telemetryCanary,
    );
  });
});
