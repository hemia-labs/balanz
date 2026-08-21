import { registerAs } from '@nestjs/config';

export interface EmailConfig {
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  appName: string;
  appSubtitle: string;
  appUrl: string;
  assetsBaseUrl: string;
  verificationSubject: string;
  supportEmail: string;
  helpUrl: string;
  privacyUrl: string;
  termsUrl: string;
  recoveryDelayMs: number;
  workerSweepMs: number;
  workerBatchSize: number;
  maxAttempts: number;
  retryBaseMs: number;
}

export default registerAs(
  'email',
  (): EmailConfig => ({
    smtp: {
      host: process.env.SMTP_HOST || 'localhost',
      port: Number(process.env.SMTP_PORT) || 1025,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || 'noreply@localhost',
        pass: process.env.SMTP_PASSWORD || '',
      },
    },
    appName: process.env.EMAIL_APP_NAME || 'Balanz',
    appSubtitle: process.env.EMAIL_APP_SUBTITLE || 'Contable',
    appUrl: process.env.EMAIL_APP_URL || 'http://localhost:3000',
    assetsBaseUrl: (
      process.env.EMAIL_ASSETS_BASE_URL || 'https://cdn.hemia.dev'
    ).replace(/\/+$/, ''),
    verificationSubject:
      process.env.EMAIL_VERIFICATION_SUBJECT || 'Verifica tu correo',
    supportEmail: process.env.EMAIL_SUPPORT_EMAIL || 'soporte@balanz.mx',
    helpUrl: process.env.EMAIL_HELP_URL || 'https://app.balanz.mx/ayuda',
    privacyUrl:
      process.env.EMAIL_PRIVACY_URL || 'https://app.balanz.mx/privacidad',
    termsUrl: process.env.EMAIL_TERMS_URL || 'https://app.balanz.mx/terminos',
    recoveryDelayMs: Number(process.env.EMAIL_RECOVERY_DELAY_MS) || 30_000,
    workerSweepMs: Number(process.env.EMAIL_WORKER_SWEEP_MS) || 60_000,
    workerBatchSize: Number(process.env.EMAIL_WORKER_BATCH_SIZE) || 20,
    maxAttempts: Number(process.env.EMAIL_MAX_ATTEMPTS) || 5,
    retryBaseMs: Number(process.env.EMAIL_RETRY_BASE_MS) || 60_000,
  }),
);
