import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CsrfGuard } from '../src/common/guards/csrf.guard';

function context(
  method: string,
  headers: Record<string, string> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        get: (header: string) => headers[header.toLowerCase()],
      }),
    }),
  } as ExecutionContext;
}

function guard(): CsrfGuard {
  return new CsrfGuard({
    get: (key: string, fallback: unknown) =>
      key === 'app.corsOrigins'
        ? ['https://app.example', 'http://localhost:3000']
        : fallback,
  } as ConfigService);
}

describe('CsrfGuard', () => {
  it('allows safe methods without origin headers', () => {
    expect(guard().canActivate(context('GET'))).toBe(true);
    expect(guard().canActivate(context('HEAD'))).toBe(true);
    expect(guard().canActivate(context('OPTIONS'))).toBe(true);
  });

  it('allows an exact configured Origin and rejects other origins', () => {
    expect(
      guard().canActivate(context('POST', { origin: 'https://app.example' })),
    ).toBe(true);
    expect(() =>
      guard().canActivate(context('PATCH', { origin: 'https://evil.example' })),
    ).toThrow('Invalid request origin');
    expect(() =>
      guard().canActivate(
        context('DELETE', { origin: 'https://app.example.evil.test' }),
      ),
    ).toThrow('Invalid request origin');
  });

  it('falls back to the exact Referer origin when Origin is absent', () => {
    expect(
      guard().canActivate(
        context('PUT', { referer: 'https://app.example/clients/123' }),
      ),
    ).toBe(true);
    expect(() =>
      guard().canActivate(
        context('PUT', { referer: 'https://evil.example/clients/123' }),
      ),
    ).toThrow('Invalid request origin');
  });

  it('rejects unsafe requests with missing or malformed origin evidence', () => {
    expect(() => guard().canActivate(context('POST'))).toThrow(
      'Missing request origin',
    );
    expect(() =>
      guard().canActivate(context('POST', { origin: 'not a URL' })),
    ).toThrow('Invalid request origin');
    expect(() =>
      guard().canActivate(
        context('POST', { origin: 'https://app.example/path' }),
      ),
    ).toThrow('Invalid request origin');
  });
});
