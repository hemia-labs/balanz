export interface AwsEmailSecret {
  aws_access_key: string;
  aws_secret_key: string;
  aws_region: string;
  aws_session_token?: string;
}

export function isAwsEmailSecret(value: unknown): value is AwsEmailSecret {
  if (!value || typeof value !== 'object') return false;

  const secret = value as Record<string, unknown>;
  return (
    isNonEmptyString(secret.aws_access_key) &&
    isNonEmptyString(secret.aws_secret_key) &&
    isNonEmptyString(secret.aws_region) &&
    (secret.aws_session_token === undefined ||
      isNonEmptyString(secret.aws_session_token))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
