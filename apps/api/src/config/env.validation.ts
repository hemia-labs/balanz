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
  EMAIL_VERIFICATION_TTL_MINUTES: Joi.number()
    .integer()
    .min(15)
    .max(60)
    .default(30),
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
  AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(86_400)
    .default(300),

  // Email. SMTP_* sólo se usa como fallback cuando Secrets está deshabilitado.
  SMTP_HOST: Joi.string().trim().min(1).default('localhost'),
  SMTP_PORT: Joi.number().port().default(1025),
  SMTP_SECURE: Joi.boolean().truthy('true').falsy('false').default(false),
  SMTP_USER: Joi.string().trim().min(1).default('noreply@localhost'),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  EMAIL_APP_NAME: Joi.string().trim().min(1).default('Balanz'),
  EMAIL_APP_SUBTITLE: Joi.string().trim().min(1).default('Contable'),
  EMAIL_VERIFICATION_SUBJECT: Joi.string()
    .trim()
    .min(1)
    .default('Verifica tu correo'),
  EMAIL_SUPPORT_EMAIL: Joi.string().email().default('soporte@balanz.mx'),
  EMAIL_HELP_URL: Joi.string().uri().default('https://app.balanz.mx/ayuda'),
  EMAIL_PRIVACY_URL: Joi.string()
    .uri()
    .default('https://app.balanz.mx/privacidad'),
  EMAIL_TERMS_URL: Joi.string().uri().default('https://app.balanz.mx/terminos'),
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
  EMAIL_RECOVERY_DELAY_MS: Joi.number().integer().min(1_000).default(30_000),
  EMAIL_WORKER_SWEEP_MS: Joi.number().integer().min(10_000).default(60_000),
  EMAIL_WORKER_BATCH_SIZE: Joi.number().integer().min(1).max(100).default(20),
  EMAIL_MAX_ATTEMPTS: Joi.number().integer().min(1).max(20).default(5),
  EMAIL_RETRY_BASE_MS: Joi.number().integer().min(1_000).default(60_000),

  AUTH_SESSION_COOKIE_NAME: Joi.string()
    .trim()
    .pattern(/^[A-Za-z0-9_-]+$/)
    .default('balanz_session'),
  AUTH_SESSION_TTL_SECONDS: Joi.number()
    .integer()
    .min(300)
    .max(2_592_000)
    .default(28_800),
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
