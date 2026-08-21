import { TemplateManager } from '@hemia/email-sender';
import '../src/modules/email/email.module';
import { EMAIL_VERIFICATION_TEMPLATE } from '../src/modules/email/templates/email-verification.template';

describe('email template renderer', () => {
  it('resolves EJS data and returns compiled HTML for Hemia email sender', async () => {
    const html = await TemplateManager.render(
      '<mjml><mj-body><mj-section><mj-column><mj-text><%= name %></mj-text></mj-column></mj-section></mj-body></mjml>',
      { name: 'Ana' },
    );

    expect(html).toContain('Ana');
    expect(html).not.toContain('<%= name %>');
    expect(html).not.toContain('<mjml>');
  });

  it('renders the verification template with its production data shape', async () => {
    const html = await TemplateManager.render(EMAIL_VERIFICATION_TEMPLATE, {
      assetsBaseUrl: 'https://cdn.example.test',
      appName: 'Balanz',
      appSubtitle: 'Contable',
      logoLetter: 'B',
      previewText: 'Confirma tu correo',
      headline: 'Activa tu cuenta',
      greeting: 'Hola, bienvenida',
      bodyText: 'Confirma tu correo para continuar.',
      ctaLabel: 'Activar cuenta',
      fallbackText: 'Si el botón no funciona:',
      verificationUrl: 'https://app.example.test/verify-email#token=test',
      expirationText: 'El enlace expira pronto.',
      unrequestedText: 'Si no solicitaste esto, ignora el correo.',
      supportTitle: '¿Necesitas ayuda?',
      supportEmailPrefix: 'Escríbenos a',
      supportEmail: 'soporte@example.test',
      supportEmailLabel: 'soporte@example.test',
      supportHelpPrefix: 'o visita nuestro',
      helpUrl: 'https://app.example.test/ayuda',
      helpLabel: 'Centro de ayuda',
      footerDescription: 'Plataforma contable',
      privacyUrl: 'https://app.example.test/privacidad',
      privacyLabel: 'Aviso de privacidad',
      termsUrl: 'https://app.example.test/terminos',
      termsLabel: 'Términos y condiciones',
    });

    expect(html).toContain('validate-email-v1.jpg');
    expect(html).toContain('email-wt-v1.png');
    expect(html).toContain('link-v2.png');
    expect(html).toContain('background-color:#E6F1EE');
    expect(html).toContain('width:30px');
    expect(html).not.toContain('<mjml>');
  });
});
