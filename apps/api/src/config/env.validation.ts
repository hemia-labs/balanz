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

  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_DATABASE: Joi.string().required(),
  DB_LOGGING: Joi.boolean().truthy('true').falsy('false').default(false),

  // Auth (JWT)
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
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
  BCRYPT_SALT_ROUNDS: Joi.number().integer().min(4).max(31).required(),
});
