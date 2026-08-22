import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  passwordSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS),
  emailVerificationTtlMinutes:
    Number(process.env.EMAIL_VERIFICATION_TTL_MINUTES) || 30,
  trialDurationDays: Number(process.env.TRIAL_DURATION_DAYS) || 30,
  sessionTtlSeconds: Number(process.env.AUTH_SESSION_TTL_SECONDS) || 28_800,
  sessionActivityPersistIntervalSeconds:
    Number(process.env.AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS) || 300,
  mfaEncryptionKey: process.env.MFA_ENCRYPTION_KEY,
  verificationResendLimit:
    Number(process.env.AUTH_VERIFICATION_RESEND_LIMIT) || 3,
  verificationResendWindowSeconds:
    Number(process.env.AUTH_VERIFICATION_RESEND_WINDOW_SECONDS) || 900,
  mfaVerifyLimit: Number(process.env.AUTH_MFA_VERIFY_LIMIT) || 5,
  mfaVerifyWindowSeconds:
    Number(process.env.AUTH_MFA_VERIFY_WINDOW_SECONDS) || 300,
}));
