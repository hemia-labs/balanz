import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailSenderService } from '@hemia/email-sender';
import type { EmailConfig } from '../../../config/email.config';
import type { EmailDeliveryPort } from '../ports/email-delivery.port';
import {
  EMAIL_VERIFICATION_TEMPLATE,
  type EmailVerificationTemplateData,
} from '../templates/email-verification.template';

@Injectable()
export class HemiaEmailDeliveryAdapter implements EmailDeliveryPort {
  constructor(
    private readonly sender: EmailSenderService,
    private readonly config: ConfigService,
  ) {}

  async sendVerification(input: {
    email: string;
    firstName?: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    const emailConfig = this.config.getOrThrow<EmailConfig>('email');
    const verificationUrl = new URL('/verify-email', emailConfig.appUrl);
    verificationUrl.hash = new URLSearchParams({
      token: input.token,
    }).toString();
    const verificationTtlMinutes = this.config.get<number>(
      'auth.emailVerificationTtlMinutes',
      30,
    );
    const data: EmailVerificationTemplateData = {
      assetsBaseUrl: emailConfig.assetsBaseUrl,
      appName: emailConfig.appName,
      appSubtitle: emailConfig.appSubtitle,
      logoLetter: emailConfig.appName.trim().charAt(0).toUpperCase() || 'B',
      previewText: `Confirma tu correo para activar tu cuenta de ${emailConfig.appName}.`,
      headline: 'Activa tu cuenta',
      greeting: input.firstName
        ? `Hola ${input.firstName}, ¡te damos la bienvenida a ${emailConfig.appName}!`
        : `Hola, ¡te damos la bienvenida a ${emailConfig.appName}!`,
      bodyText: `Solo falta un paso: confirma tu correo electrónico para activar tu cuenta y empezar a gestionar tus CFDI.`,
      ctaLabel: 'Activar cuenta',
      fallbackText:
        'Si el botón no funciona, copia y pega este enlace en tu navegador:',
      verificationUrl: verificationUrl.toString(),
      expirationText: `Este enlace es válido por ${verificationTtlMinutes} min.`,
      unrequestedText:
        'Si tú no creaste esta cuenta, no necesitas realizar ninguna acción. Puedes ignorar este correo de forma segura.',
      supportTitle: '¿Necesitas ayuda?',
      supportEmailPrefix: 'Escríbenos a',
      supportEmail: emailConfig.supportEmail,
      supportEmailLabel: emailConfig.supportEmail,
      helpUrl: emailConfig.helpUrl,
      supportHelpPrefix: 'o visita nuestro',
      helpLabel: 'Centro de ayuda',
      footerDescription: 'Plataforma de contabilidad y CFDI',
      privacyUrl: emailConfig.privacyUrl,
      privacyLabel: 'Aviso de privacidad',
      termsUrl: emailConfig.termsUrl,
      termsLabel: 'Términos y condiciones',
    };

    await this.sender.sendEmail({
      to: input.email,
      subject: emailConfig.verificationSubject,
      template: EMAIL_VERIFICATION_TEMPLATE,
      data,
      app: emailConfig.appName,
    });
  }
}
