import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  passwordSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS),
  emailVerificationTtlMinutes:
    Number(process.env.EMAIL_VERIFICATION_TTL_MINUTES) || 30,
  passwordResetTtlMinutes:
    Number(process.env.AUTH_PASSWORD_RESET_TTL_MINUTES) || 60,
  trialDurationDays: Number(process.env.TRIAL_DURATION_DAYS) || 30,
  sessionTtlSeconds: Number(process.env.AUTH_SESSION_TTL_SECONDS) || 28_800,
  sessionIdleTtlSeconds:
    Number(process.env.AUTH_SESSION_IDLE_TTL_SECONDS) || 1_800,
  sessionActivityPersistIntervalSeconds:
    Number(process.env.AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS) || 300,
  authorizationCacheTtlSeconds:
    Number(process.env.AUTHORIZATION_CACHE_TTL_SECONDS) || 60,
  mfaEncryptionKey: process.env.MFA_ENCRYPTION_KEY,
  verificationResendLimit:
    Number(process.env.AUTH_VERIFICATION_RESEND_LIMIT) || 3,
  verificationResendWindowSeconds:
    Number(process.env.AUTH_VERIFICATION_RESEND_WINDOW_SECONDS) || 900,
  verificationRegisterLimit:
    Number(process.env.AUTH_VERIFICATION_REGISTER_LIMIT) || 3,
  verificationRegisterWindowSeconds:
    Number(process.env.AUTH_VERIFICATION_REGISTER_WINDOW_SECONDS) || 900,
  verificationConfirmLimit:
    Number(process.env.AUTH_VERIFICATION_CONFIRM_LIMIT) || 5,
  verificationConfirmWindowSeconds:
    Number(process.env.AUTH_VERIFICATION_CONFIRM_WINDOW_SECONDS) || 300,
  passwordResetRequestLimit:
    Number(process.env.AUTH_PASSWORD_RESET_REQUEST_LIMIT) || 3,
  passwordResetRequestWindowSeconds:
    Number(process.env.AUTH_PASSWORD_RESET_REQUEST_WINDOW_SECONDS) || 900,
  passwordResetConfirmLimit:
    Number(process.env.AUTH_PASSWORD_RESET_CONFIRM_LIMIT) || 5,
  passwordResetConfirmWindowSeconds:
    Number(process.env.AUTH_PASSWORD_RESET_CONFIRM_WINDOW_SECONDS) || 300,
  mfaVerifyLimit: Number(process.env.AUTH_MFA_VERIFY_LIMIT) || 5,
  mfaVerifyWindowSeconds:
    Number(process.env.AUTH_MFA_VERIFY_WINDOW_SECONDS) || 300,
  throttlerLimit: Number(process.env.AUTH_THROTTLER_LIMIT) || 60,
  throttlerTtlMs: Number(process.env.AUTH_THROTTLER_TTL_MS) || 60_000,
  throttlerBlockDurationMs:
    Number(process.env.AUTH_THROTTLER_BLOCK_DURATION_MS) || 60_000,
}));
