import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';
import { createPaymentsClient, type PaymentsConnection } from '@hemia/payments';

export type PaymentsSettings = {
  connection?: PaymentsConnection;
  clientSecret: string;
};
export const paymentsEnvSettings = {
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
    PAYMENTS_CONNECTION: env.PAYMENTS_CONNECTION,
    HEMIA_CLIENT_SECRET: env.HEMIA_CLIENT_SECRET,
  });
  if (result.error)
    throw new Error(
      `Invalid payments configuration: ${result.error.details.map((item) => item.path.join('.')).join(', ')}`,
    );
  const value = result.value as {
    PAYMENTS_CONNECTION: string;
    HEMIA_CLIENT_SECRET: string;
  };
  return {
    connection: value.PAYMENTS_CONNECTION
      ? (JSON.parse(value.PAYMENTS_CONNECTION) as PaymentsConnection)
      : undefined,
    clientSecret: value.HEMIA_CLIENT_SECRET,
  };
}
export default registerAs('payments', () => getPaymentsSettings());
