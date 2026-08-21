import { EmailSenderService } from '@hemia/email-sender';
import { ConfigService } from '@nestjs/config';
import { HemiaEmailDeliveryAdapter } from '../src/modules/email/adapters/hemia-email-delivery.adapter';
import { EMAIL_VERIFICATION_TEMPLATE } from '../src/modules/email/templates/email-verification.template';

describe('HemiaEmailDeliveryAdapter', () => {
  it('builds a verification link without putting the token in the query string', async () => {
    const sendEmail = jest.fn((input: unknown) => Promise.resolve(input));
    const sender = {
      sendEmail,
    } as unknown as EmailSenderService;
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        appName: 'Balanz',
        appSubtitle: 'Contable',
        appUrl: 'https://app.example.test',
        assetsBaseUrl: 'https://cdn.example.test',
        verificationSubject: 'Verifica tu correo',
        supportEmail: 'soporte@balanz.mx',
        helpUrl: 'https://app.example.test/ayuda',
        privacyUrl: 'https://app.example.test/privacidad',
        termsUrl: 'https://app.example.test/terminos',
      }),
      get: jest.fn().mockReturnValue(30),
    } as unknown as ConfigService;
    const adapter = new HemiaEmailDeliveryAdapter(sender, config);

    await adapter.sendVerification({
      email: 'ana@example.test',
      firstName: 'Ana',
      token: 'raw-token',
      expiresAt: new Date('2026-08-20T00:00:00.000Z'),
    });

    const sent = sendEmail.mock.calls[0][0] as {
      to: string;
      app: string;
      template: string;
      data: {
        appName: string;
        greeting: string;
        verificationUrl: string;
        expirationText: string;
        supportEmail: string;
        helpUrl: string;
        privacyUrl: string;
        termsUrl: string;
      };
    };
    expect(sent.to).toBe('ana@example.test');
    expect(sent.app).toBe('Balanz');
    expect(sent.template).toBe(EMAIL_VERIFICATION_TEMPLATE);
    expect(sent.template).toContain('<mjml>');
    expect(sent.template).toContain('<mj-head>');
    expect(sent.template).not.toContain('9f2c8a1e-4b7d-46f0-a3c2-1e5b90d47a11');
    expect(sent.template).toContain(
      '<%= assetsBaseUrl %>/email/projects/cfdi/logos/logo-v1.png',
    );
    expect(sent.data.verificationUrl).toBe(
      'https://app.example.test/verify-email#token=raw-token',
    );
    expect(sent.data.appName).toBe('Balanz');
    expect(sent.data.greeting).toContain('Ana');
    expect(sent.data.expirationText).toBe('Este enlace es válido por 30 min.');
    expect(sent.data.supportEmail).toBe('soporte@balanz.mx');
    expect(sent.data.helpUrl).toBe('https://app.example.test/ayuda');
    expect(sent.data.privacyUrl).toBe('https://app.example.test/privacidad');
    expect(sent.data.termsUrl).toBe('https://app.example.test/terminos');
  });
});
