import { ConfigService } from '@nestjs/config';
import { StubMfaProvider } from '../src/modules/auth/stub-mfa.provider';

describe('StubMfaProvider', () => {
  const config = (nodeEnv: string, code = '123456') =>
    ({
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'app.nodeEnv') return nodeEnv;
        if (key === 'auth.mfaStubCode') return code;
        return fallback;
      }),
    }) as unknown as ConfigService;

  it('verifies only the configured development code', async () => {
    const provider = new StubMfaProvider(config('test'));
    const setup = await provider.setup('user-1');

    expect(setup.providerReference).toMatch(/^stub:/);
    expect(setup.factorType).toBe('provider_mfa');
    await expect(
      provider.verify(setup.providerReference, '123456'),
    ).resolves.toBe(true);
    await expect(
      provider.verify(setup.providerReference, '000000'),
    ).resolves.toBe(false);
  });

  it('cannot be constructed in production', () => {
    expect(() => new StubMfaProvider(config('production'))).toThrow(
      'MFA_PROVIDER=stub is not allowed in production',
    );
  });
});
