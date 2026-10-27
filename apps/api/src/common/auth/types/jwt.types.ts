export const JWT_SECRETS = Symbol('JWT_SECRETS');

export type JwtSecrets = {
  bcrypt_salt_rounds: number;
  cookie_secure: boolean;
  jwt_expires_in: string;
  jwt_refresh_expires_in: string;
  jwt_refresh_secret: string;
  jwt_secret: string;
};

export function isJwtSecrets(value: unknown): value is JwtSecrets {
  if (!value || typeof value !== 'object') return false;

  const secret = value as Record<string, unknown>;
  return (
    typeof secret.bcrypt_salt_rounds === 'number' &&
    Number.isInteger(secret.bcrypt_salt_rounds) &&
    secret.bcrypt_salt_rounds >= 4 &&
    secret.bcrypt_salt_rounds <= 31 &&
    typeof secret.cookie_secure === 'boolean' &&
    typeof secret.jwt_expires_in === 'string' &&
    secret.jwt_expires_in.length > 0 &&
    typeof secret.jwt_refresh_expires_in === 'string' &&
    secret.jwt_refresh_expires_in.length > 0 &&
    typeof secret.jwt_refresh_secret === 'string' &&
    secret.jwt_refresh_secret.length >= 16 &&
    typeof secret.jwt_secret === 'string' &&
    secret.jwt_secret.length >= 16
  );
}
