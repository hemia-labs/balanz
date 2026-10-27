import { registerAs } from '@nestjs/config';

export interface EmailConfig {
  ses: {
    project: string;
    environment: string;
    fromName: string;
    fromAuth: string;
    fromNotifications: string;
    replyTo: string;
    configurationSetAuth: string;
    configurationSetTransactional: string;
    verificationTemplate: string;
    welcomeTemplate: string;
    mfaEnabledTemplate: string;
    mfaDisabledTemplate: string;
    passwordResetTemplate: string;
    invitationTemplate: string;
  };
  appName: string;
  appSubtitle: string;
  appUrl: string;
  assetsBaseUrl: string;
  iconEmailUrl: string;
  supportEmail: string;
  helpUrl: string;
  privacyUrl: string;
  termsUrl: string;
  companyAddress: string;
}

export default registerAs('email', (): EmailConfig => {
  const project = process.env.EMAIL_PROJECT || 'cfdios';
  const environment = process.env.EMAIL_ENVIRONMENT || 'dev';

  return {
    ses: {
      project,
      environment,
      fromName: process.env.EMAIL_FROM_NAME || 'Balanz',
      fromAuth: process.env.EMAIL_FROM_AUTH || `auth@${project}.hemia.dev`,
      fromNotifications:
        process.env.EMAIL_FROM_NOTIFICATIONS ||
        `notifications@${project}.hemia.dev`,
      replyTo: process.env.EMAIL_REPLY_TO || 'support@hemia.dev',
      configurationSetAuth:
        process.env.EMAIL_CONFIGURATION_SET_AUTH || `hemia-${environment}-auth`,
      configurationSetTransactional:
        process.env.EMAIL_CONFIGURATION_SET_TRANSACTIONAL ||
        `hemia-${environment}-transactional`,
      verificationTemplate:
        process.env.EMAIL_VERIFICATION_TEMPLATE ||
        `${project}-${environment}-email-verification`,
      welcomeTemplate:
        process.env.EMAIL_WELCOME_TEMPLATE ||
        `${project}-${environment}-welcome`,
      mfaEnabledTemplate:
        process.env.EMAIL_MFA_ENABLED_TEMPLATE ||
        `${project}-${environment}-mfa-enabled`,
      mfaDisabledTemplate:
        process.env.EMAIL_MFA_DISABLED_TEMPLATE ||
        `${project}-${environment}-mfa-disabled`,
      passwordResetTemplate:
        process.env.EMAIL_PASSWORD_RESET_TEMPLATE ||
        `${project}-${environment}-forgot-password`,
      invitationTemplate:
        process.env.EMAIL_INVITATION_TEMPLATE ||
        `${project}-${environment}-invitation`,
    },
    appName: process.env.EMAIL_APP_NAME || 'Balanz',
    appSubtitle: process.env.EMAIL_APP_SUBTITLE || 'Contable',
    appUrl: process.env.EMAIL_APP_URL || 'http://localhost:5181',
    assetsBaseUrl: (
      process.env.EMAIL_ASSETS_BASE_URL || 'https://cdn.hemia.dev'
    ).replace(/\/+$/, ''),
    iconEmailUrl:
      process.env.EMAIL_ICON_EMAIL_URL ||
      'https://cdn.hemia.dev/icon-email.png',
    supportEmail: process.env.EMAIL_SUPPORT_EMAIL || 'soporte@balanz.mx',
    helpUrl: process.env.EMAIL_HELP_URL || 'https://app.balanz.mx/ayuda',
    privacyUrl:
      process.env.EMAIL_PRIVACY_URL || 'https://app.balanz.mx/privacidad',
    termsUrl: process.env.EMAIL_TERMS_URL || 'https://app.balanz.mx/terminos',
    companyAddress: process.env.EMAIL_COMPANY_ADDRESS || '',
  };
});
