import 'reflect-metadata';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import paymentsConfig, {
  getPaymentsSettings,
  loadPaymentsSettings,
  paymentsEnvSettings,
  type PaymentsSettings,
} from '../src/config/payments.config';
import { paymentsConnection } from './payments-fixture';

test('accepts generated config without a secret in the JSON and rejects unsafe destinations', () => {
  expect(
    getPaymentsSettings({
      PAYMENTS_CONNECTION: JSON.stringify(paymentsConnection),
      HEMIA_CLIENT_SECRET: 'secret',
    }),
  ).toEqual({ connection: paymentsConnection, clientSecret: 'secret' });
  expect(() =>
    getPaymentsSettings({
      PAYMENTS_CONNECTION: JSON.stringify({
        ...paymentsConnection,
        clientSecret: 'leaked',
      }),
    }),
  ).toThrow('PAYMENTS_CONNECTION');
  expect(() =>
    getPaymentsSettings({
      PAYMENTS_CONNECTION: JSON.stringify({
        ...paymentsConnection,
        baseUrl: 'http://public.test',
      }),
    }),
  ).toThrow('PAYMENTS_CONNECTION');
  expect(() => getPaymentsSettings({ PAYMENTS_CONNECTION: '{broken' })).toThrow(
    'PAYMENTS_CONNECTION',
  );
});

const referenceEnvironment = {
  HEMIA_BASE_URL: 'https://billing.test',
  HEMIA_CONNECTION: 'balanz_cfdi',
  HEMIA_CLIENT_ID: 'balanz-service',
  HEMIA_CLIENT_SECRET: 'fixture-secret',
};

test.each([
  { HEMIA_BASE_URL: '' },
  { HEMIA_CONNECTION: '' },
  { HEMIA_CLIENT_ID: '' },
  { HEMIA_CLIENT_SECRET: '' },
  { HEMIA_CONNECTION: 'discovery' },
  { PAYMENTS_CONNECTION: JSON.stringify(paymentsConnection) },
])(
  'rejects an incomplete, reserved or mixed connection source: %j',
  (change) => {
    expect(() =>
      getPaymentsSettings({ ...referenceEnvironment, ...change }),
    ).toThrow();
  },
);

test('async Nest configuration resolves the published connection once and shares it with ConfigService consumers', async () => {
  const keys = Object.keys(paymentsEnvSettings);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, referenceEnvironment);
  const configuration = {
    ...paymentsConnection,
    issuer: 'https://identity.test',
    tokenUrl: 'https://identity.test/oauth/token',
    baseUrl: 'https://billing.test/api/v1',
    resource: 'https://billing.test',
  };
  const upstream = jest.spyOn(global, 'fetch').mockImplementation((input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.endsWith('/connections/discovery'))
      return Promise.resolve(
        Response.json({
          contract: 'hemia.payments.connections.v2',
          issuer: configuration.issuer,
          tokenUrl: configuration.tokenUrl,
          audience: configuration.audience,
          resource: configuration.resource,
          scope: 'billing.integration.connections.read',
          configurationPath:
            '/api/v1/billing/integrations/v2/connections/{connectionCode}',
        }),
      );
    if (url === configuration.tokenUrl)
      return Promise.resolve(
        Response.json({
          access_token: 'fixture-token',
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'billing.integration.connections.read',
        }),
      );
    if (url.endsWith('/connections/balanz_cfdi'))
      return Promise.resolve(
        Response.json({
          contract: 'hemia.payments.connection.v2',
          connectionCode: 'balanz_cfdi',
          version: 1,
          configuration,
        }),
      );
    throw new Error('Unexpected fixture request');
  });
  let module: TestingModule | undefined;
  try {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forFeature(paymentsConfig)],
      providers: [
        {
          provide: 'PAYMENTS_CONSUMER',
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            config.getOrThrow<PaymentsSettings>('payments'),
        },
      ],
    }).compile();
    const config = module.get(ConfigService);
    const settings = config.getOrThrow<PaymentsSettings>('payments');
    expect(settings).toEqual({
      connection: configuration,
      clientSecret: referenceEnvironment.HEMIA_CLIENT_SECRET,
    });
    expect(settings.connection).not.toHaveProperty('clientSecret');
    expect(config.getOrThrow<PaymentsSettings>('payments')).toBe(settings);
    expect(module.get<PaymentsSettings>(paymentsConfig.KEY)).toBe(settings);
    expect(module.get<PaymentsSettings>('PAYMENTS_CONSUMER')).toBe(settings);
    expect(upstream).toHaveBeenCalledTimes(3);
  } finally {
    await module?.close();
    upstream.mockRestore();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a failed resolution prevents initialization instead of exposing an unresolved connection', async () => {
  const upstream = jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(new Error('offline'));
  try {
    await expect(
      loadPaymentsSettings(referenceEnvironment),
    ).rejects.toMatchObject({
      code: 'transport',
    });
  } finally {
    upstream.mockRestore();
  }
});
