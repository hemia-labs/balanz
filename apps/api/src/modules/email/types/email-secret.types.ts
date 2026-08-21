export interface EmailSecret {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
}

export function isEmailSecret(value: unknown): value is EmailSecret {
  if (!value || typeof value !== 'object') return false;

  const secret = value as Record<string, unknown>;
  return (
    typeof secret.smtp_host === 'string' &&
    typeof secret.smtp_port === 'number' &&
    typeof secret.smtp_secure === 'boolean' &&
    typeof secret.smtp_user === 'string' &&
    typeof secret.smtp_password === 'string'
  );
}
