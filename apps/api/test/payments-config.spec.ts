import { getPaymentsSettings } from '../src/config/payments.config';
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
