import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export const BILLING_CHECKOUT_SCOPES = [
  'billing.integration.catalog.read',
  'billing.integration.checkout.create',
  'billing.integration.checkout.read',
] as const;

export const billingIdentityEnvSettings = {
  BILLING_IDENTITY_TOKEN_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .default('')
    .custom((value: string, helpers) => {
      if (!value) return value;
      const url = new URL(value);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      const environment = (
        helpers.state.ancestors as { NODE_ENV?: string }[]
      )[0]?.NODE_ENV;
      if (
        url.username ||
        url.password ||
        url.hash ||
        url.search ||
        (url.protocol !== 'https:' && (!local || environment === 'production'))
      ) {
        return helpers.error('any.invalid');
      }
      return value;
    }),
  BILLING_CLIENT_ID: Joi.string()
    .trim()
    .min(1)
    .max(120)
    .default('balanz-billing-service'),
  BILLING_CLIENT_SECRET: Joi.string().max(255).allow('').default(''),
  BILLING_IDENTITY_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(30_000)
    .default(5_000),
};

export type BillingIdentityConfig = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
};

export function getBillingIdentityConfig(
  env = process.env,
): BillingIdentityConfig {
  const result = Joi.object({
    NODE_ENV: Joi.string()
      .valid('development', 'test', 'production')
      .default('development'),
    ...billingIdentityEnvSettings,
  }).validate({
    NODE_ENV: env.NODE_ENV,
    ...Object.fromEntries(
      Object.keys(billingIdentityEnvSettings).map((key) => [key, env[key]]),
    ),
  });
  if (result.error) {
    throw new Error(
      `Invalid Billing Identity configuration: ${result.error.details.map((detail) => detail.path.join('.')).join(', ')}`,
    );
  }
  const value = result.value as {
    BILLING_IDENTITY_TOKEN_URL: string;
    BILLING_CLIENT_ID: string;
    BILLING_CLIENT_SECRET: string;
    BILLING_IDENTITY_TIMEOUT_MS: number;
  };
  return {
    tokenUrl: value.BILLING_IDENTITY_TOKEN_URL,
    clientId: value.BILLING_CLIENT_ID,
    clientSecret: value.BILLING_CLIENT_SECRET,
    timeoutMs: value.BILLING_IDENTITY_TIMEOUT_MS,
  };
}

export default registerAs('billingIdentity', () => getBillingIdentityConfig());
