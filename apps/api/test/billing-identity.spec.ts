import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  BILLING_CHECKOUT_SCOPES,
  getBillingIdentityConfig,
} from '../src/config/billing-identity.config';
import { BillingIdentityService } from '../src/modules/billing/billing-identity.service';
import {
  apiEnvVarsSchema,
  workerEnvVarsSchema,
} from '../src/config/env.validation';

const settings = {
  tokenUrl: 'http://localhost:4000/oauth/token',
  clientId: 'balanz-billing-service',
  clientSecret: 'test-secret',
  timeoutMs: 100,
};
const tokenResponse = {
  access_token: 'signed.service.token',
  token_type: 'Bearer',
  expires_in: 600,
  scope: BILLING_CHECKOUT_SCOPES.join(' '),
};
function service(overrides: Partial<typeof settings> = {}) {
  return new BillingIdentityService(
    new ConfigService({ billingIdentity: { ...settings, ...overrides } }),
  );
}
function response(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ...tokenResponse, ...overrides }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => jest.restoreAllMocks());

describe('Billing Identity service token', () => {
  it('posts service credentials and shares/caches concurrent requests', async () => {
    const fetchToken = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response());
    const client = service();
    await expect(
      Promise.all([client.getAccessToken(), client.getAccessToken()]),
    ).resolves.toEqual([
      tokenResponse.access_token,
      tokenResponse.access_token,
    ]);
    await expect(client.getAccessToken()).resolves.toBe(
      tokenResponse.access_token,
    );
    expect(fetchToken).toHaveBeenCalledTimes(1);
    const [url, options] = fetchToken.mock.calls[0];
    expect(url).toBe(settings.tokenUrl);
    expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const body = options?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe(settings.clientId);
    expect(body.get('client_secret')).toBe(settings.clientSecret);
    expect(body.get('scope')).toBe(tokenResponse.scope);
  });

  it('renews before expiry', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const fetchToken = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(response()));
    const client = service();
    await client.getAccessToken();
    clock.mockReturnValue(571_000);
    await client.getAccessToken();
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('fails closed without a secret and makes no external request', async () => {
    const fetchToken = jest.spyOn(globalThis, 'fetch');
    await expect(
      service({ clientSecret: '' }).getAccessToken(),
    ).rejects.toThrow('BILLING_CLIENT_SECRET');
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it('sanitizes provider rejection and recovers on the next attempt', async () => {
    const fetchToken = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('provider-body-with-test-secret', { status: 401 }),
      )
      .mockResolvedValueOnce(response());
    const client = service();
    await expect(client.getAccessToken()).rejects.toThrow(
      'No se pudo autenticar Balanz con Identity para Billing.',
    );
    await expect(client.getAccessToken()).resolves.toBe(
      tokenResponse.access_token,
    );
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('sanitizes network/timeout failures', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('request containing test-secret'));
    await expect(service().getAccessToken()).rejects.toThrow(
      'No se pudo autenticar Balanz con Identity para Billing.',
    );
  });

  it.each([
    { expires_in: 0 },
    { expires_in: 601 },
    { expires_in: '600' },
    { access_token: 'invalid token' },
    { token_type: 'Basic' },
    { scope: 'billing.integration.checkout.create' },
  ])(
    'rejects invalid or insufficient token responses: %j',
    async (overrides) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(overrides));
      await expect(service().getAccessToken()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    },
  );
});

describe('Billing Identity configuration', () => {
  it('allows preparing local configuration with an empty secret', () => {
    expect(
      getBillingIdentityConfig({
        NODE_ENV: 'development',
        BILLING_IDENTITY_TOKEN_URL: settings.tokenUrl,
      }),
    ).toMatchObject({
      clientId: settings.clientId,
      clientSecret: '',
      timeoutMs: 5_000,
    });
  });

  it.each([
    ['production', settings.tokenUrl],
    ['development', 'http://identity.example.test/oauth/token'],
    ['development', 'https://user:password@identity.example.test/oauth/token'],
    ['development', 'https://identity.example.test/oauth/token#fragment'],
  ])('rejects unsafe endpoints in %s', (environment, tokenUrl) => {
    expect(() =>
      getBillingIdentityConfig({
        NODE_ENV: environment,
        BILLING_IDENTITY_TOKEN_URL: tokenUrl,
      }),
    ).toThrow('BILLING_IDENTITY_TOKEN_URL');
  });

  it('accepts HTTPS in production and validates the timeout', () => {
    expect(
      getBillingIdentityConfig({
        NODE_ENV: 'production',
        BILLING_IDENTITY_TOKEN_URL: 'https://id.hemia.cloud/oauth/token',
      }).tokenUrl,
    ).toBe('https://id.hemia.cloud/oauth/token');
    expect(() =>
      getBillingIdentityConfig({ BILLING_IDENTITY_TIMEOUT_MS: '0' }),
    ).toThrow('BILLING_IDENTITY_TIMEOUT_MS');
  });

  it('validates the API settings and rejects credentials in the worker profile', () => {
    const base = {
      NODE_ENV: 'development',
      DB_HOST: 'localhost',
      DB_DATABASE: 'balanz_test',
    };
    const api = {
      ...base,
      DB_API_USERNAME: 'balanz_api_login',
      DB_API_PASSWORD: 'api-runtime-password',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      BCRYPT_SALT_ROUNDS: 12,
      BILLING_IDENTITY_TOKEN_URL: settings.tokenUrl,
    };
    expect(apiEnvVarsSchema.validate(api).error).toBeUndefined();
    const worker = {
      ...base,
      DB_WORKER_USERNAME: 'balanz_worker_login',
      DB_WORKER_PASSWORD: 'worker-runtime-password',
      BILLING_CLIENT_SECRET: settings.clientSecret,
    };
    expect(workerEnvVarsSchema.validate(worker).error?.message).toContain(
      'BILLING_CLIENT_SECRET',
    );
  });
});
