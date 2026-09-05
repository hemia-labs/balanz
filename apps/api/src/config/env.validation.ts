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

interface EnvironmentConfig {
  NODE_ENV?: string;
  SECRETS_ENABLED?: boolean;
  SECRETS_ENVIRONMENT?: string;
  HORUS_URL?: string;
  HORUS_KEY?: string;
  OBJECT_STORAGE_DRIVER?: string;
  MALWARE_SCANNER_MODE?: string;
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_SSE_MODE?: string;
  S3_KMS_KEY_ID?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  CLAMAV_MAX_STREAM_BYTES?: number;
  INGESTION_XML_MAX_BYTES?: number;
  INGESTION_ZIP_MAX_BYTES?: number;
  WORKER_LEASE_SECONDS?: number;
  WORKER_HEARTBEAT_SECONDS?: number;
  DB_CONNECTION_TIMEOUT_MS?: number;
  HEALTH_CHECK_TIMEOUT_MS?: number;
  [key: string]: unknown;
}

// Base contract shared by the two runtime profiles. Each entrypoint applies a
// stricter projection below so credentials/configuration for the other process
// are rejected before Nest creates providers.
const baseEnvVarsSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),

  // App
  APP_PORT: Joi.number().port().default(3021),
  APP_GLOBAL_PREFIX: Joi.string().default('api/v1'),
  APP_CORS_ORIGINS: Joi.when('NODE_ENV', {
    is: 'production',
    then: corsOriginsSetting.trim().min(1).required(),
    otherwise: corsOriginsSetting.allow('').default(''),
  }),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(16).default(0),

  // Horus (opcional hasta que se asignen las variables del proyecto).
  HORUS_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .default(''),
  HORUS_KEY: Joi.string().trim().allow('').default(''),
  HORUS_RELEASE: Joi.string().trim().allow('').default(''),
  HORUS_TIMEOUT_MS: Joi.number().integer().min(1).max(10_000).default(2000),

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
  SECRETS_OWNER: Joi.string().trim().min(1).default('balanz'),
  SECRETS_SYSTEM: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.string().trim().min(1).required(),
      otherwise: Joi.string().trim().min(1).default('api'),
    }),
    otherwise: Joi.string().trim().min(1).default('api'),
  }),
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
  DB_CONNECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(30_000)
    .default(2_000),
  // Runtime credentials are distinct from the migration credential. With
  // Vault enabled they come from database/postgres-api|postgres-worker.
  DB_API_USERNAME: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().trim().allow('').optional(),
    otherwise: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.string().trim().min(1).required(),
      otherwise: Joi.string().trim().allow('').default(''),
    }),
  }),
  DB_API_PASSWORD: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().allow('').optional(),
    otherwise: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(16).required(),
      otherwise: Joi.string().allow('').default(''),
    }),
  }),
  DB_WORKER_USERNAME: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().trim().allow('').optional(),
    otherwise: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.string().trim().min(1).required(),
      otherwise: Joi.string().trim().allow('').default(''),
    }),
  }),
  DB_WORKER_PASSWORD: Joi.when('SECRETS_ENABLED', {
    is: true,
    then: Joi.string().allow('').optional(),
    otherwise: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(16).required(),
      otherwise: Joi.string().allow('').default(''),
    }),
  }),

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
  AUTH_PASSWORD_RESET_TTL_MINUTES: Joi.number()
    .integer()
    .min(15)
    .max(60)
    .default(60),
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
  AUTH_PASSWORD_RESET_REQUEST_LIMIT: Joi.number()
    .integer()
    .positive()
    .default(3),
  AUTH_PASSWORD_RESET_REQUEST_WINDOW_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(900),
  AUTH_PASSWORD_RESET_CONFIRM_LIMIT: Joi.number()
    .integer()
    .positive()
    .default(5),
  AUTH_PASSWORD_RESET_CONFIRM_WINDOW_SECONDS: Joi.number()
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
  REDIS_WAKEUP_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
  REDIS_WAKEUP_PREFIX: Joi.string()
    .trim()
    .pattern(/^[A-Za-z0-9:_-]+$/)
    .default('balanz:ingestion:wakeup'),
  REDIS_WAKEUP_TIMEOUT_MS: Joi.number()
    .integer()
    .min(50)
    .max(5_000)
    .default(500),

  // CFDI Phase 0: object storage. Production is constrained again by the
  // cross-field validation at the end of this schema.
  OBJECT_STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
  OBJECT_STORAGE_LOCAL_ROOT: Joi.string()
    .trim()
    .min(1)
    .default('.local/fiscal-object-storage'),
  OBJECT_STORAGE_LOCAL_WINDOWS_PRESECURED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.valid(false).default(false),
      otherwise: Joi.boolean().default(false),
    }),
  OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(15)
    .max(300)
    .default(60),
  S3_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .default(''),
  S3_REGION: Joi.string().trim().min(1).default('us-east-2'),
  S3_BUCKET: Joi.string().trim().allow('').default(''),
  S3_FORCE_PATH_STYLE: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(false),
  S3_SSE_MODE: Joi.string()
    .valid('none', 'AES256', 'aws:kms')
    .default('AES256'),
  S3_KMS_KEY_ID: Joi.string().trim().allow('').default(''),
  S3_ACCESS_KEY_ID: Joi.string().trim().allow('').default(''),
  S3_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  S3_REQUEST_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(120_000)
    .default(10_000),

  // CFDI Phase 0: malware scanner. Bypass is never the implicit default.
  MALWARE_SCANNER_MODE: Joi.string()
    .valid('clamav', 'bypass')
    .default('clamav'),
  CLAMAV_HOST: Joi.string().trim().min(1).default('127.0.0.1'),
  CLAMAV_PORT: Joi.number().port().default(3310),
  CLAMAV_CONNECT_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(30_000)
    .default(2_000),
  CLAMAV_SCAN_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(300_000)
    .default(30_000),
  CLAMAV_MAX_STREAM_BYTES: Joi.number()
    .integer()
    .min(1)
    .max(100 * 1024 * 1024)
    .default(50 * 1024 * 1024),

  // CFDI Phase 0: durable worker. These locked values are asserted below too.
  WORKER_CONCURRENCY: Joi.number().integer().min(1).max(32).default(4),
  WORKER_LEASE_SECONDS: Joi.number().integer().valid(90).default(90),
  WORKER_HEARTBEAT_SECONDS: Joi.number().integer().valid(20).default(20),
  WORKER_MAX_ATTEMPTS: Joi.number().integer().valid(4).default(4),
  WORKER_MAX_RETRIES: Joi.number().integer().valid(3).default(3),
  WORKER_BACKOFF_SECONDS: Joi.string().valid('10,30,120').default('10,30,120'),
  WORKER_BACKOFF_JITTER_PERCENT: Joi.number()
    .integer()
    .min(0)
    .max(50)
    .default(20),
  WORKER_POLL_INTERVAL_MS: Joi.number()
    .integer()
    .min(100)
    .max(60_000)
    .default(5_000),
  WORKER_RECONCILE_INTERVAL_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(3_600_000)
    .default(60_000),
  WORKER_QUEUE_METRICS_INTERVAL_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(300_000)
    .default(30_000),
  WORKER_SHUTDOWN_GRACE_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(120_000)
    .default(30_000),
  WORKER_HEALTH_HOST: Joi.string().trim().min(1).default('127.0.0.1'),
  WORKER_HEALTH_PORT: Joi.number().port().default(3002),

  INGESTION_INCOMPLETE_UPLOAD_HOURS: Joi.number()
    .integer()
    .valid(24)
    .default(24),
  INGESTION_DUPLICATE_BYTES_HOURS: Joi.number().integer().valid(24).default(24),
  INGESTION_ORPHAN_GRACE_MINUTES: Joi.number().integer().valid(60).default(60),
  INGESTION_INVALID_OBJECT_DAYS: Joi.number().integer().valid(7).default(7),
  INGESTION_MALWARE_QUARANTINE_DAYS: Joi.number().integer().valid(7).default(7),
  INGESTION_COMPLETED_OBJECT_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(3650)
    .default(30),
  INGESTION_XML_MAX_BYTES: Joi.number()
    .integer()
    .valid(5 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  INGESTION_DIRECT_XML_MAX_COUNT: Joi.number().integer().valid(1).default(1),
  INGESTION_ZIP_MAX_BYTES: Joi.number()
    .integer()
    .valid(50 * 1024 * 1024)
    .default(50 * 1024 * 1024),
  INGESTION_XML_MAX_DEPTH: Joi.number().integer().valid(64).default(64),
  INGESTION_XML_MAX_NODES: Joi.number()
    .integer()
    .valid(200_000)
    .default(200_000),
  INGESTION_XML_MAX_ATTRIBUTES: Joi.number()
    .integer()
    .valid(100_000)
    .default(100_000),
  INGESTION_XML_MAX_ATTRIBUTES_PER_ELEMENT: Joi.number()
    .integer()
    .valid(128)
    .default(128),
  INGESTION_XML_MAX_TEXT_NODE_BYTES: Joi.number()
    .integer()
    .valid(1024 * 1024)
    .default(1024 * 1024),
  INGESTION_XML_PARSE_TIMEOUT_MS: Joi.number()
    .integer()
    .valid(5_000)
    .default(5_000),
  WORKER_MEMORY_TARGET_MIB: Joi.number().integer().valid(256).default(256),
  INGESTION_ACTIVE_JOBS_PER_USER: Joi.number().integer().valid(2).default(2),
  INGESTION_ACTIVE_JOBS_PER_TENANT: Joi.number().integer().valid(4).default(4),
  METRICS_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .valid(true)
    .default(true),
  METRICS_PATH: Joi.string().valid('/metrics').default('/metrics'),
  HEALTH_CHECK_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(10_000)
    .default(2_000),
  HEALTH_STORAGE_PROBE_INTERVAL_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(300_000)
    .default(30_000),
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
  EMAIL_FROM_NAME: Joi.string().trim().min(1).default('Balanz'),
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
  EMAIL_PASSWORD_RESET_TEMPLATE: Joi.string()
    .trim()
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .default('cfdios-dev-forgot-password'),
  EMAIL_ICON_EMAIL_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('https://cdn.hemia.dev/icon-email.png'),
  EMAIL_APP_NAME: Joi.string().trim().min(1).default('Balanz'),
  EMAIL_APP_SUBTITLE: Joi.string().trim().min(1).default('Contable'),
  EMAIL_SUPPORT_EMAIL: Joi.string().email().default('soporte@balanz.mx'),
  EMAIL_HELP_URL: Joi.string().uri().default('https://app.balanz.mx/ayuda'),
  EMAIL_PRIVACY_URL: Joi.string()
    .uri()
    .default('https://app.balanz.mx/privacidad'),
  EMAIL_TERMS_URL: Joi.string().uri().default('https://app.balanz.mx/terminos'),
  EMAIL_COMPANY_ADDRESS: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().trim().allow('').default(''),
  }),
  EMAIL_APP_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string()
      .uri({ scheme: ['http', 'https'] })
      .default('http://localhost:5181'),
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
}).custom((value: EnvironmentConfig, helpers) => {
  const horusUrl = value.HORUS_URL ?? '';
  const horusKey = value.HORUS_KEY ?? '';
  const hasUrl = horusUrl.trim().length > 0;
  const hasKey = horusKey.trim().length > 0;

  if (hasUrl !== hasKey) {
    return helpers.message({
      custom: 'HORUS_URL and HORUS_KEY must be configured together',
    });
  }

  if (hasUrl) {
    const parsedHorusUrl = new URL(horusUrl);
    if (
      horusUrl.includes('?') ||
      horusUrl.includes('#') ||
      parsedHorusUrl.username ||
      parsedHorusUrl.password
    ) {
      return helpers.message({
        custom: 'HORUS_URL must not include query, fragment, or credentials',
      });
    }

    if (
      value.NODE_ENV === 'production' &&
      parsedHorusUrl.protocol !== 'https:'
    ) {
      return helpers.message({
        custom: 'HORUS_URL must use HTTPS in production',
      });
    }
  }

  const nodeEnv = value.NODE_ENV ?? 'development';
  const secretsEnabled = value.SECRETS_ENABLED === true;
  const secretsEnvironment = value.SECRETS_ENVIRONMENT ?? 'dev';
  const databaseLogging = value.DB_LOGGING === true;
  const storageDriver = value.OBJECT_STORAGE_DRIVER ?? 'local';
  const scannerMode = value.MALWARE_SCANNER_MODE ?? 'clamav';
  const s3Endpoint = (value.S3_ENDPOINT ?? '').trim();
  const s3Bucket = (value.S3_BUCKET ?? '').trim();
  const s3Encryption = value.S3_SSE_MODE ?? 'AES256';
  const kmsKeyId = (value.S3_KMS_KEY_ID ?? '').trim();
  const s3AccessKey = (value.S3_ACCESS_KEY_ID ?? '').trim();
  const s3SecretKey = value.S3_SECRET_ACCESS_KEY ?? '';

  if (
    nodeEnv === 'production' &&
    secretsEnabled &&
    secretsEnvironment !== 'prod'
  ) {
    return helpers.message({
      custom:
        'Production with SECRETS_ENABLED=true requires SECRETS_ENVIRONMENT=prod',
    });
  }

  if (nodeEnv === 'production' && databaseLogging) {
    return helpers.message({
      custom: 'Production API/worker runtimes require DB_LOGGING=false',
    });
  }

  if (s3AccessKey.length > 0 !== s3SecretKey.length > 0) {
    return helpers.message({
      custom:
        'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together',
    });
  }

  if (storageDriver === 's3' && s3Bucket.length === 0) {
    return helpers.message({ custom: 'S3_BUCKET is required for S3 storage' });
  }

  if (s3Encryption === 'aws:kms' && kmsKeyId.length === 0) {
    return helpers.message({
      custom: 'S3_KMS_KEY_ID is required when S3_SSE_MODE=aws:kms',
    });
  }

  if (nodeEnv === 'production') {
    if (storageDriver !== 's3') {
      return helpers.message({
        custom: 'Production requires OBJECT_STORAGE_DRIVER=s3',
      });
    }
    if (scannerMode !== 'clamav') {
      return helpers.message({
        custom: 'Production requires MALWARE_SCANNER_MODE=clamav',
      });
    }
    if (s3Encryption !== 'aws:kms' || kmsKeyId.length === 0) {
      return helpers.message({
        custom: 'Production requires S3_SSE_MODE=aws:kms and S3_KMS_KEY_ID',
      });
    }
    if (s3Endpoint.length > 0 && new URL(s3Endpoint).protocol !== 'https:') {
      return helpers.message({
        custom: 'S3_ENDPOINT must use HTTPS in production',
      });
    }
  }

  if (scannerMode === 'bypass' && nodeEnv !== 'development') {
    return helpers.message({
      custom:
        'MALWARE_SCANNER_MODE=bypass is allowed only in explicit development configuration',
    });
  }

  const scannerMaxBytes = Number(value.CLAMAV_MAX_STREAM_BYTES);
  const largestScannableObject = Math.max(
    Number(value.INGESTION_XML_MAX_BYTES),
    Number(value.INGESTION_ZIP_MAX_BYTES),
  );
  if (scannerMaxBytes < largestScannableObject) {
    return helpers.message({
      custom:
        'CLAMAV_MAX_STREAM_BYTES must be greater than or equal to the largest configured ingestion object limit',
    });
  }

  const leaseSeconds = Number(value.WORKER_LEASE_SECONDS ?? 90);
  const heartbeatSeconds = Number(value.WORKER_HEARTBEAT_SECONDS ?? 20);
  if (heartbeatSeconds * 3 >= leaseSeconds) {
    return helpers.message({
      custom: 'WORKER_HEARTBEAT_SECONDS must be less than one third of lease',
    });
  }

  if (
    Number(value.DB_CONNECTION_TIMEOUT_MS) >
    Number(value.HEALTH_CHECK_TIMEOUT_MS)
  ) {
    return helpers.message({
      custom:
        'DB_CONNECTION_TIMEOUT_MS must not exceed HEALTH_CHECK_TIMEOUT_MS so readiness probes cannot accumulate pool waiters',
    });
  }

  return value;
}, 'Horus configuration validation');

export type RuntimeConfigProfile = 'api' | 'worker';

const unavailableToProfile = () => Joi.any().empty('').forbidden();

const runtimeDatabaseUsername = Joi.when('SECRETS_ENABLED', {
  is: true,
  then: Joi.string().trim().allow('').optional(),
  otherwise: Joi.string().trim().min(1).required(),
});

const runtimeDatabasePassword = Joi.when('SECRETS_ENABLED', {
  is: true,
  then: Joi.string().allow('').optional(),
  otherwise: Joi.string().min(16).required(),
});

const workerUnavailableKeys = [
  'APP_PORT',
  'APP_GLOBAL_PREFIX',
  'APP_CORS_ORIGINS',
  'TRUST_PROXY_HOPS',
  'DB_API_USERNAME',
  'DB_API_PASSWORD',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'JWT_REFRESH_SECRET',
  'JWT_REFRESH_EXPIRES_IN',
  'EMAIL_VERIFICATION_TTL_MINUTES',
  'TRIAL_DURATION_DAYS',
  'EMAIL_PROJECT',
  'EMAIL_ENVIRONMENT',
  'EMAIL_FROM_NAME',
  'EMAIL_FROM_AUTH',
  'EMAIL_FROM_NOTIFICATIONS',
  'EMAIL_REPLY_TO',
  'EMAIL_CONFIGURATION_SET_AUTH',
  'EMAIL_CONFIGURATION_SET_TRANSACTIONAL',
  'EMAIL_VERIFICATION_TEMPLATE',
  'EMAIL_WELCOME_TEMPLATE',
  'EMAIL_MFA_ENABLED_TEMPLATE',
  'EMAIL_MFA_DISABLED_TEMPLATE',
  'EMAIL_APP_NAME',
  'EMAIL_APP_SUBTITLE',
  'EMAIL_SUPPORT_EMAIL',
  'EMAIL_HELP_URL',
  'EMAIL_PRIVACY_URL',
  'EMAIL_TERMS_URL',
  'EMAIL_COMPANY_ADDRESS',
  'EMAIL_APP_URL',
  'EMAIL_ASSETS_BASE_URL',
  'AUTH_SESSION_COOKIE_NAME',
  'AUTH_SESSION_TTL_SECONDS',
  'AUTH_SESSION_IDLE_TTL_SECONDS',
  'AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS',
  'AUTHORIZATION_CACHE_TTL_SECONDS',
  'MFA_ENCRYPTION_KEY',
  'AUTH_VERIFICATION_RESEND_LIMIT',
  'AUTH_VERIFICATION_RESEND_WINDOW_SECONDS',
  'AUTH_VERIFICATION_REGISTER_LIMIT',
  'AUTH_VERIFICATION_REGISTER_WINDOW_SECONDS',
  'AUTH_VERIFICATION_CONFIRM_LIMIT',
  'AUTH_VERIFICATION_CONFIRM_WINDOW_SECONDS',
  'AUTH_MFA_VERIFY_LIMIT',
  'AUTH_MFA_VERIFY_WINDOW_SECONDS',
  'AUTH_THROTTLER_LIMIT',
  'AUTH_THROTTLER_TTL_MS',
  'AUTH_THROTTLER_BLOCK_DURATION_MS',
  'COOKIE_SECURE',
  'COOKIE_SAME_SITE',
  'COOKIE_DOMAIN',
  'BCRYPT_SALT_ROUNDS',
] as const;

export const apiEnvVarsSchema = baseEnvVarsSchema
  .fork(
    ['DB_USERNAME', 'DB_PASSWORD', 'DB_WORKER_USERNAME', 'DB_WORKER_PASSWORD'],
    unavailableToProfile,
  )
  .keys({
    DB_API_USERNAME: runtimeDatabaseUsername,
    DB_API_PASSWORD: runtimeDatabasePassword,
  });

export const workerEnvVarsSchema = baseEnvVarsSchema
  .fork(
    ['DB_USERNAME', 'DB_PASSWORD', ...workerUnavailableKeys],
    unavailableToProfile,
  )
  .keys({
    DB_WORKER_USERNAME: runtimeDatabaseUsername,
    DB_WORKER_PASSWORD: runtimeDatabasePassword,
  });

export function envVarsSchemaForRuntime(
  profile: RuntimeConfigProfile,
): Joi.ObjectSchema {
  return profile === 'api' ? apiEnvVarsSchema : workerEnvVarsSchema;
}

// Compatibility name for existing API configuration tests and consumers.
export const envVarsSchema = apiEnvVarsSchema;
