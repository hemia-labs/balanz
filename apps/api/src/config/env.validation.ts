import * as Joi from 'joi';
import { parseCorsOrigins } from './cors-origins';

const corsOriginsSetting = Joi.string().custom((value: string, helpers) => {
  try {
    parseCorsOrigins(value);
    return value;
  } catch (error) {
    return helpers.message({
      custom:
        error instanceof Error ? error.message : 'APP_CORS_ORIGINS is invalid',
    });
  }
}, 'HTTP(S) origins validation');

// Valida las env al boot: la app falla-rápido si falta o es inválida alguna variable.
export const envVarsSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),

  // App
  APP_PORT: Joi.number().port().default(3001),
  APP_GLOBAL_PREFIX: Joi.string().default('api/v1'),
  APP_CORS_ORIGINS: Joi.when('NODE_ENV', {
    is: 'production',
    then: corsOriginsSetting.trim().min(1).required(),
    otherwise: corsOriginsSetting.allow('').default(''),
  }),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(16).default(0),

  // Secrets
  SECRETS_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  SECRETS_ENVIRONMENT: Joi.string()
    .valid('dev', 'qa', 'staging', 'prod')
    .default('dev'),
  SECRETS_CATEGORY: Joi.string()
    .valid(
      'internal',
      'external',
      'clients',
      'partners',
      'whitelabel',
      'shared',
    )
    .default('internal'),
  SECRETS_OWNER: Joi.string().trim().min(1).default('hemia'),
  SECRETS_SYSTEM: Joi.string().trim().min(1).default('api'),
  SECRETS_CACHE_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
  SECRETS_CACHE_TTL_MS: Joi.number().integer().min(1).default(60000),
  VAULT_BASE_URL: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  VAULT_ROLE_ID: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  VAULT_SECRET_ID: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  VAULT_AUTH_PATH: Joi.string().trim().min(1).default('approle'),
  VAULT_MOUNT_PREFIX: Joi.string()
    .pattern(/^[a-z0-9](?:[a-z0-9_-]*)?$/)
    .default('kv-'),
  VAULT_TIMEOUT_MS: Joi.number().integer().min(1).default(5000),

  // Database
  DB_HOST: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().optional(),
    otherwise: Joi.string().required(),
  }),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().optional(),
    otherwise: Joi.string().required(),
  }),
  DB_PASSWORD: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().allow('').optional(),
    otherwise: Joi.string().allow('').required(),
  }),
  DB_DATABASE: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().optional(),
    otherwise: Joi.string().required(),
  }),
  DB_LOGGING: Joi.boolean().truthy('true').falsy('false').default(false),

  // Auth (JWT)
  JWT_SECRET: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().min(16).optional(),
    otherwise: Joi.string().min(16).required(),
  }),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().min(16).optional(),
    otherwise: Joi.string().min(16).required(),
  }),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  EMAIL_VERIFICATION_TTL_MINUTES: Joi.number()
    .integer()
    .min(15)
    .max(60)
    .default(30),
  AUTH_VERIFICATION_REGISTER_LIMIT: Joi.number()
    .integer()
    .positive()
    .default(3),
  AUTH_VERIFICATION_REGISTER_WINDOW_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(900),
  AUTH_VERIFICATION_CONFIRM_LIMIT: Joi.number().integer().positive().default(5),
  AUTH_VERIFICATION_CONFIRM_WINDOW_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(300),
  TRIAL_DURATION_DAYS: Joi.number().integer().positive().default(30),

  // Redis session cache. When Secrets are enabled these values are read from
  // cache/redis, except for the local feature flag and operational settings.
  REDIS_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  REDIS_HOST: Joi.string().trim().allow('').optional(),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().allow('').optional(),
    otherwise: Joi.string().allow('').default(''),
  }),
  REDIS_DB: Joi.number().integer().min(0).max(15).default(0),
  REDIS_KEY_PREFIX: Joi.string().trim().min(1).default('balanz:'),
  REDIS_CONNECT_TIMEOUT_MS: Joi.number().integer().min(1).default(1000),
  // Email (SESv2). AWS_REGION sólo se usa sin Vault; las demás credenciales
  // se resuelven con la cadena estándar del SDK.
  AWS_REGION: Joi.string().trim().min(1).default('us-east-2'),
  EMAIL_PROJECT: Joi.string()
    .trim()
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .default('cfdios'),
  EMAIL_ENVIRONMENT: Joi.string()
    .valid('dev', 'qa', 'staging', 'prod')
    .default('dev'),
  EMAIL_FROM_NAME: Joi.string().trim().min(1).default('CFDIOS'),
  EMAIL_FROM_AUTH: Joi.string().email().default('auth@cfdios.hemia.dev'),
  EMAIL_FROM_NOTIFICATIONS: Joi.string()
    .email()
    .default('notifications@cfdios.hemia.dev'),
  EMAIL_REPLY_TO: Joi.string().email().default('support@hemia.dev'),
  EMAIL_CONFIGURATION_SET_AUTH: Joi.string()
    .trim()
    .min(1)
    .default('hemia-dev-auth'),
  EMAIL_CONFIGURATION_SET_TRANSACTIONAL: Joi.string()
    .trim()
    .min(1)
    .default('hemia-dev-transactional'),
  EMAIL_VERIFICATION_TEMPLATE: Joi.string()
    .trim()
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .default('cfdios-dev-email-verification'),
  EMAIL_WELCOME_TEMPLATE: Joi.string()
    .trim()
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .default('cfdios-dev-welcome'),
  EMAIL_MFA_ENABLED_TEMPLATE: Joi.string()
    .trim()
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .default('cfdios-dev-mfa-enabled'),
  EMAIL_MFA_DISABLED_TEMPLATE: Joi.string()
    .trim()
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .default('cfdios-dev-mfa-disabled'),
  EMAIL_APP_NAME: Joi.string().trim().min(1).default('Balanz'),
  EMAIL_APP_SUBTITLE: Joi.string().trim().min(1).default('Contable'),
  EMAIL_SUPPORT_EMAIL: Joi.string().email().default('soporte@balanz.mx'),
  EMAIL_HELP_URL: Joi.string().uri().default('https://app.balanz.mx/ayuda'),
  EMAIL_PRIVACY_URL: Joi.string()
    .uri()
    .default('https://app.balanz.mx/privacidad'),
  EMAIL_TERMS_URL: Joi.string().uri().default('https://app.balanz.mx/terminos'),
  EMAIL_COMPANY_ADDRESS: Joi.string().trim().allow('').default(''),
  EMAIL_APP_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string()
      .uri({ scheme: ['http', 'https'] })
      .default('http://localhost:3000'),
  }),
  EMAIL_ASSETS_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('https://cdn.hemia.dev'),

  AUTH_SESSION_COOKIE_NAME: Joi.string()
    .trim()
    .pattern(/^[A-Za-z0-9_-]+$/)
    .default('balanz_session'),
  AUTH_SESSION_TTL_SECONDS: Joi.number()
    .integer()
    .min(300)
    .max(2_592_000)
    .default(28_800),
  AUTH_SESSION_IDLE_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(2_592_000)
    .default(1_800),
  AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(1_800)
    .less(Joi.ref('AUTH_SESSION_IDLE_TTL_SECONDS'))
    .default(300),
  AUTHORIZATION_CACHE_TTL_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(3_600)
    .default(60),
  MFA_ENCRYPTION_KEY: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().base64().length(44).optional(),
    otherwise: Joi.string().base64().length(44).optional(),
  }),
  AUTH_VERIFICATION_RESEND_LIMIT: Joi.number()
    .integer()
    .min(1)
    .max(20)
    .default(3),
  AUTH_VERIFICATION_RESEND_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(86_400)
    .default(900),
  AUTH_MFA_VERIFY_LIMIT: Joi.number().integer().min(1).max(20).default(5),
  AUTH_MFA_VERIFY_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(86_400)
    .default(300),
  AUTH_THROTTLER_LIMIT: Joi.number().integer().min(1).default(60),
  AUTH_THROTTLER_TTL_MS: Joi.number().integer().min(1).default(60_000),
  AUTH_THROTTLER_BLOCK_DURATION_MS: Joi.number()
    .integer()
    .min(1)
    .default(60_000),

  COOKIE_SECURE: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.valid(true).required(),
      otherwise: Joi.boolean().default(false),
    }),
  COOKIE_SAME_SITE: Joi.when('COOKIE_SECURE', {
    is: false,
    then: Joi.string().valid('strict', 'lax').default('lax'),
    otherwise: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.string().valid('strict', 'lax', 'none').default('strict'),
      otherwise: Joi.string().valid('strict', 'lax', 'none').default('lax'),
    }),
  }),
  COOKIE_DOMAIN: Joi.string().allow('').default(''),
  BCRYPT_SALT_ROUNDS: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.number().integer().min(4).max(31).optional(),
    otherwise: Joi.number().integer().min(4).max(31).required(),
  }),
});
