import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailConfig } from '../../../config/email.config';
import type { EmailDeliveryPort } from '../ports/email-delivery.port';

@Injectable()
export class SesEmailDeliveryAdapter implements EmailDeliveryPort {
  constructor(
    private readonly client: SESv2Client,
    private readonly config: ConfigService,
  ) {}

  async sendInvitation(input: {
    email: string;
    token: string;
    invitationId: string;
    expiresAt: Date;
  }): Promise<void> {
    const email = this.config.getOrThrow<EmailConfig>('email');
    const invitationUrl = new URL('/accept-invitation', email.appUrl);
    invitationUrl.hash = new URLSearchParams({
      invitationId: input.invitationId,
      token: input.token,
    }).toString();
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: `${email.ses.fromName} <${email.ses.fromAuth}>`,
        Destination: { ToAddresses: [input.email] },
        ReplyToAddresses: [email.ses.replyTo],
        ConfigurationSetName: email.ses.configurationSetAuth,
        Content: {
          Template: {
            TemplateName: email.ses.invitationTemplate,
            TemplateData: JSON.stringify({
              app_name: email.appName,
              invitation_url: invitationUrl.toString(),
              expiration_date: input.expiresAt.toISOString(),
              support_email: email.supportEmail,
            }),
          },
        },
      }),
    );
  }

  async sendVerification(input: {
    email: string;
    firstName?: string;
    token: string;
  }): Promise<void> {
    const email = this.config.getOrThrow<EmailConfig>('email');
    const verificationUrl = new URL('/verify-email', email.appUrl);
    verificationUrl.hash = new URLSearchParams({
      token: input.token,
    }).toString();
    const verificationTtlMinutes = this.config.get<number>(
      'auth.emailVerificationTtlMinutes',
      30,
    );

    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: `${email.ses.fromName} <${email.ses.fromAuth}>`,
        Destination: { ToAddresses: [input.email] },
        ReplyToAddresses: [email.ses.replyTo],
        ConfigurationSetName: email.ses.configurationSetAuth,
        Content: {
          Template: {
            TemplateName: email.ses.verificationTemplate,
            TemplateData: JSON.stringify({
              assetsBaseUrl: email.assetsBaseUrl,
              appName: email.appName,
              appSubtitle: email.appSubtitle,
              previewText: `Confirma tu correo para activar tu cuenta de ${email.appName}.`,
              headline: 'Activa tu cuenta',
              greeting: input.firstName
                ? `Hola ${input.firstName}, ¡te damos la bienvenida a ${email.appName}!`
                : `Hola, ¡te damos la bienvenida a ${email.appName}!`,
              bodyText:
                'Solo falta un paso: confirma tu correo electrónico para activar tu cuenta y empezar a gestionar tus CFDI.',
              ctaLabel: 'Activar cuenta',
              fallbackText:
                'Si el botón no funciona, copia y pega este enlace en tu navegador:',
              verificationUrl: verificationUrl.toString(),
              expirationText: `Este enlace es válido por ${verificationTtlMinutes} min.`,
              unrequestedText:
                'Si tú no creaste esta cuenta, no necesitas realizar ninguna acción. Puedes ignorar este correo de forma segura.',
              supportTitle: '¿Necesitas ayuda?',
              supportEmailPrefix: 'Escríbenos a',
              supportEmail: email.supportEmail,
              supportHelpPrefix: 'o visita nuestro',
              helpLabel: 'Centro de ayuda',
              helpUrl: email.helpUrl,
              footerDescription: 'Plataforma de contabilidad y CFDI',
              privacyLabel: 'Aviso de privacidad',
              privacyUrl: email.privacyUrl,
              termsLabel: 'Términos y condiciones',
              termsUrl: email.termsUrl,
            }),
          },
        },
      }),
    );
  }

  async sendPasswordReset(input: {
    email: string;
    firstName?: string;
    token: string;
    locale?: string;
  }): Promise<void> {
    const email = this.config.getOrThrow<EmailConfig>('email');
    const locale = input.locale?.split('-')[0] === 'en' ? 'en' : 'es';
    const resetUrl = new URL(`/${locale}/forgot-password`, email.appUrl);
    resetUrl.hash = new URLSearchParams({ token: input.token }).toString();

    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: `${email.appName} <${email.ses.fromAuth}>`,
        Destination: { ToAddresses: [input.email] },
        ReplyToAddresses: [email.ses.replyTo],
        ConfigurationSetName: email.ses.configurationSetAuth,
        Content: {
          Template: {
            TemplateName: email.ses.passwordResetTemplate,
            TemplateData: JSON.stringify({
              app_name: email.appName,
              assets_base_url: email.assetsBaseUrl,
              company_address: email.companyAddress,
              icon_email_url: email.iconEmailUrl,
              reset_url: resetUrl.toString(),
              user_name: input.firstName ?? '',
            }),
          },
        },
      }),
    );
  }

  async sendWelcome(input: {
    email: string;
    firstName?: string;
    organizationName: string;
    locale?: string;
    timezone?: string;
    trialEndsAt: Date;
  }): Promise<void> {
    const email = this.config.getOrThrow<EmailConfig>('email');
    const locale = input.locale?.split('-')[0] || 'es';
    const onboardingUrl = new URL(`/${locale}/onboarding`, email.appUrl);
    const trialEndsAt = new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'long',
      timeZone: input.timezone || 'America/Mexico_City',
    }).format(input.trialEndsAt);

    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: `${email.ses.fromName} <${email.ses.fromNotifications}>`,
        Destination: { ToAddresses: [input.email] },
        ReplyToAddresses: [email.ses.replyTo],
        ConfigurationSetName: email.ses.configurationSetTransactional,
        Content: {
          Template: {
            TemplateName: email.ses.welcomeTemplate,
            TemplateData: JSON.stringify({
              assetsBaseUrl: email.assetsBaseUrl,
              first_name: input.firstName ?? '',
              organization_name: input.organizationName,
              trial_end_date: trialEndsAt,
              onboardingUrl: onboardingUrl.toString(),
            }),
          },
        },
      }),
    );
  }

  async sendMfaEnabled(input: {
    email: string;
    firstName?: string;
    mfaStatus: string;
    mfaMethod: string;
    activatedAt: Date;
    deviceName: string;
    locale?: string;
    timezone?: string;
  }): Promise<void> {
    await this.sendMfa(input, 'mfaEnabledTemplate');
  }

  async sendMfaDisabled(input: {
    email: string;
    firstName?: string;
    mfaStatus: string;
    mfaMethod: string;
    activatedAt: Date;
    deviceName: string;
    locale?: string;
    timezone?: string;
  }): Promise<void> {
    await this.sendMfa(input, 'mfaDisabledTemplate');
  }

  private async sendMfa(
    input: {
      email: string;
      firstName?: string;
      mfaStatus: string;
      mfaMethod: string;
      activatedAt: Date;
      deviceName: string;
      locale?: string;
      timezone?: string;
    },
    template: 'mfaEnabledTemplate' | 'mfaDisabledTemplate',
  ): Promise<void> {
    const email = this.config.getOrThrow<EmailConfig>('email');
    const locale = input.locale?.split('-')[0] === 'en' ? 'en' : 'es';
    const activatedAt = new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: input.timezone || 'America/Mexico_City',
    }).format(input.activatedAt);

    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: `${email.ses.fromName} <${email.ses.fromAuth}>`,
        Destination: { ToAddresses: [input.email] },
        ReplyToAddresses: [email.ses.replyTo],
        ConfigurationSetName: email.ses.configurationSetAuth,
        Content: {
          Template: {
            TemplateName: email.ses[template],
            TemplateData: JSON.stringify({
              assetsBaseUrl: email.assetsBaseUrl,
              first_name: input.firstName ?? '',
              mfa_status: input.mfaStatus,
              mfa_method: input.mfaMethod,
              activated_at: activatedAt,
              device_name: input.deviceName,
              security_settings_url: new URL(
                `/${locale}/security`,
                email.appUrl,
              ).toString(),
              reset_password_url: new URL(
                `/${locale}/forgot-password`,
                email.appUrl,
              ).toString(),
              support_url: new URL(`/${locale}/help`, email.appUrl).toString(),
              company_address: email.companyAddress,
            }),
          },
        },
      }),
    );
  }
}
