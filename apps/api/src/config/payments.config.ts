import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';
import {
  createPaymentsClient,
  resolvePaymentsConnection,
  type PaymentsConnection,
  type PaymentsConnectionOptions,
} from '@hemia/payments';

export type PaymentsSettings = {
  connection?: PaymentsConnection;
  clientSecret: string;
  reference?: Pick<
    PaymentsConnectionOptions,
    'baseUrl' | 'connectionCode' | 'clientId'
  >;
};
export const paymentsEnvSettings = {
  HEMIA_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .default(''),
  HEMIA_CONNECTION: Joi.string()
    .pattern(/^[a-z][a-z0-9_-]{1,79}$/)
    .invalid('discovery')
    .allow('')
    .default(''),
  HEMIA_CLIENT_ID: Joi.string().max(120).pattern(/^\S+$/).allow('').default(''),
  PAYMENTS_CONNECTION: Joi.string()
    .max(16000)
    .allow('')
    .default('')
    .custom((value: string, helpers) => {
      if (!value) return value;
      try {
        const parsed: unknown = JSON.parse(value);
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          'clientSecret' in parsed
        )
          throw new Error();
        createPaymentsClient({
          ...(parsed as PaymentsConnection),
          clientSecret: 'configuration-validation',
        });
        return value;
      } catch {
        return helpers.error('any.invalid');
      }
    }),
  HEMIA_CLIENT_SECRET: Joi.string().max(255).allow('').default(''),
};
export function getPaymentsSettings(env = process.env): PaymentsSettings {
  const result = Joi.object(paymentsEnvSettings).validate({
    HEMIA_BASE_URL: env.HEMIA_BASE_URL,
    HEMIA_CONNECTION: env.HEMIA_CONNECTION,
    HEMIA_CLIENT_ID: env.HEMIA_CLIENT_ID,
    PAYMENTS_CONNECTION: env.PAYMENTS_CONNECTION,
    HEMIA_CLIENT_SECRET: env.HEMIA_CLIENT_SECRET,
  });
  if (result.error)
    throw new Error(
      `Invalid payments configuration: ${result.error.details.map((item) => item.path.join('.')).join(', ')}`,
    );
  const value = result.value as {
    HEMIA_BASE_URL: string;
    HEMIA_CONNECTION: string;
    HEMIA_CLIENT_ID: string;
    PAYMENTS_CONNECTION: string;
    HEMIA_CLIENT_SECRET: string;
  };
  if (value.HEMIA_BASE_URL || value.HEMIA_CONNECTION || value.HEMIA_CLIENT_ID) {
    const missing = [
      'HEMIA_BASE_URL',
      'HEMIA_CONNECTION',
      'HEMIA_CLIENT_ID',
      'HEMIA_CLIENT_SECRET',
    ].filter((key) => !value[key as keyof typeof value]);
    if (missing.length)
      throw new Error(`Invalid payments configuration: ${missing.join(', ')}`);
    if (value.PAYMENTS_CONNECTION)
      throw new Error(
        'Configure HEMIA_CONNECTION or PAYMENTS_CONNECTION, not both.',
      );
    return {
      reference: {
        baseUrl: value.HEMIA_BASE_URL,
        connectionCode: value.HEMIA_CONNECTION,
        clientId: value.HEMIA_CLIENT_ID,
      },
      clientSecret: value.HEMIA_CLIENT_SECRET,
    };
  }
  return {
    connection: value.PAYMENTS_CONNECTION
      ? (JSON.parse(value.PAYMENTS_CONNECTION) as PaymentsConnection)
      : undefined,
    clientSecret: value.HEMIA_CLIENT_SECRET,
  };
}

export async function loadPaymentsSettings(
  env = process.env,
): Promise<PaymentsSettings> {
  const settings = getPaymentsSettings(env);
  if (!settings.reference) return settings;
  const connection = await resolvePaymentsConnection({
    ...settings.reference,
    clientSecret: settings.clientSecret,
    allowHttpLoopback: env.NODE_ENV !== 'production',
  });
  return { connection, clientSecret: settings.clientSecret };
}

export default registerAs('payments', () => loadPaymentsSettings());
