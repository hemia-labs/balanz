import * as Joi from 'joi';

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
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().allow('').default(''),
  }),

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
    otherwise: Joi.string().valid('strict', 'lax', 'none').default('lax'),
  }),
  COOKIE_DOMAIN: Joi.string().allow('').default(''),
  BCRYPT_SALT_ROUNDS: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.number().integer().min(4).max(31).optional(),
    otherwise: Joi.number().integer().min(4).max(31).required(),
  }),
});
