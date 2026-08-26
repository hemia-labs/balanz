import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CsrfGuard } from '../src/common/guards/csrf.guard';

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

describe('CsrfGuard', () => {
  it('rejects unsafe requests from an unconfigured origin', () => {
    const guard = new CsrfGuard({
      get: (key: string, fallback: unknown) =>
        key === 'app.nodeEnv' ? 'production' : fallback,
    } as ConfigService);

    expect(() =>
      guard.canActivate(
        context({
          method: 'POST',
          get: (header: string) =>
            header === 'origin' ? 'https://evil.example' : undefined,
        }),
      ),
    ).toThrow('Invalid request origin');
  });

  it('allows configured origins and safe methods', () => {
    const guard = new CsrfGuard({
      get: (key: string, fallback: unknown) => {
        if (key === 'app.nodeEnv') return 'production';
        if (key === 'app.corsOrigins') return ['https://app.example'];
        return fallback;
      },
    } as ConfigService);

    expect(
      guard.canActivate(
        context({
          method: 'PATCH',
          get: (header: string) =>
            header === 'origin' ? 'https://app.example' : undefined,
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        context({ method: 'GET', get: () => 'https://evil.example' }),
      ),
    ).toBe(true);
  });
});
