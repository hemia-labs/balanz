import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { ConfigService } from '@nestjs/config';
import { SesEmailDeliveryAdapter } from '../src/modules/email/adapters/ses-email-delivery.adapter';

describe('SesEmailDeliveryAdapter', () => {
  it('sends the published SES template with the token in the URL fragment', async () => {
    const send = jest
      .fn<Promise<{ MessageId: string }>, [SendEmailCommand]>()
      .mockResolvedValue({ MessageId: 'message-id' });
    const client = { send } as unknown as SESv2Client;
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        ses: {
          project: 'cfdios',
          environment: 'dev',
          fromName: 'CFDIOS',
          fromAuth: 'auth@cfdios.hemia.dev',
          replyTo: 'support@hemia.dev',
          configurationSetAuth: 'hemia-dev-auth',
          verificationTemplate: 'cfdios-dev-email-verification',
        },
        appName: 'Balanz',
        appSubtitle: 'Contable',
        appUrl: 'https://app.example.test',
        assetsBaseUrl: 'https://cdn.example.test',
        supportEmail: 'soporte@balanz.mx',
        helpUrl: 'https://app.example.test/ayuda',
        privacyUrl: 'https://app.example.test/privacidad',
        termsUrl: 'https://app.example.test/terminos',
      }),
      get: jest.fn().mockReturnValue(30),
    } as unknown as ConfigService;
    const adapter = new SesEmailDeliveryAdapter(client, config);

    await adapter.sendVerification({
      email: 'ana@example.test',
      firstName: 'Ana',
      token: 'raw-token',
    });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeDefined();
    if (!command) throw new Error('SES command was not sent');
    expect(command.input).toMatchObject({
      FromEmailAddress: 'CFDIOS <auth@cfdios.hemia.dev>',
      Destination: { ToAddresses: ['ana@example.test'] },
      ReplyToAddresses: ['support@hemia.dev'],
      ConfigurationSetName: 'hemia-dev-auth',
      Content: {
        Template: { TemplateName: 'cfdios-dev-email-verification' },
      },
    });

    const template = command.input.Content?.Template;
    if (!template?.TemplateData) throw new Error('Template data was not sent');
    const data = JSON.parse(template.TemplateData) as {
      verificationUrl: string;
      greeting: string;
      expirationText: string;
    };
    expect(data.verificationUrl).toBe(
      'https://app.example.test/verify-email#token=raw-token',
    );
    expect(data.greeting).toContain('Ana');
    expect(data.expirationText).toBe('Este enlace es válido por 30 min.');
  });

  it('sends the forgot-password template with the published variables', async () => {
    const send = jest
      .fn<Promise<{ MessageId: string }>, [SendEmailCommand]>()
      .mockResolvedValue({ MessageId: 'message-id' });
    const client = { send } as unknown as SESv2Client;
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        ses: {
          fromName: 'Balanz',
          fromAuth: 'auth@cfdios.hemia.dev',
          replyTo: 'support@hemia.dev',
          configurationSetAuth: 'hemia-dev-auth',
          passwordResetTemplate: 'cfdios-dev-forgot-password',
        },
        appName: 'Balanz',
        appUrl: 'https://app.example.com',
        assetsBaseUrl: 'https://cdn.hemia.dev',
        iconEmailUrl: 'https://cdn.hemia.dev/icon-email.png',
        companyAddress: 'Av. Reforma 123, Ciudad de México, México',
      }),
    } as unknown as ConfigService;
    const adapter = new SesEmailDeliveryAdapter(client, config);

    await adapter.sendPasswordReset({
      email: 'cristian@example.test',
      firstName: 'Cristian',
      token: 'raw-token',
      locale: 'es-MX',
    });

    const command = send.mock.calls[0]?.[0];
    if (!command) throw new Error('SES command was not sent');
    expect(command.input).toMatchObject({
      FromEmailAddress: 'Balanz <auth@cfdios.hemia.dev>',
      Destination: { ToAddresses: ['cristian@example.test'] },
      ReplyToAddresses: ['support@hemia.dev'],
      ConfigurationSetName: 'hemia-dev-auth',
      Content: {
        Template: { TemplateName: 'cfdios-dev-forgot-password' },
      },
    });

    const template = command.input.Content?.Template;
    if (!template?.TemplateData) throw new Error('Template data was not sent');
    const data = JSON.parse(template.TemplateData) as Record<string, string>;
    expect(Object.keys(data).sort()).toEqual([
      'app_name',
      'assets_base_url',
      'company_address',
      'icon_email_url',
      'reset_url',
      'user_name',
    ]);
    expect(data).toMatchObject({
      app_name: 'Balanz',
      assets_base_url: 'https://cdn.hemia.dev',
      company_address: 'Av. Reforma 123, Ciudad de México, México',
      icon_email_url: 'https://cdn.hemia.dev/icon-email.png',
      user_name: 'Cristian',
    });
    expect(data.reset_url).toBe(
      'https://app.example.com/es/forgot-password#token=raw-token',
    );
  });

  it('sends welcome through notifications and the transactional set', async () => {
    const send = jest
      .fn<Promise<{ MessageId: string }>, [SendEmailCommand]>()
      .mockResolvedValue({ MessageId: 'message-id' });
    const client = { send } as unknown as SESv2Client;
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        ses: {
          fromName: 'CFDIOS',
          fromNotifications: 'notifications@cfdios.hemia.dev',
          replyTo: 'support@hemia.dev',
          configurationSetTransactional: 'hemia-dev-transactional',
          welcomeTemplate: 'cfdios-dev-welcome',
        },
        appName: 'Balanz',
        appSubtitle: 'Contable',
        appUrl: 'https://app.example.test',
        assetsBaseUrl: 'https://cdn.example.test',
        supportEmail: 'soporte@balanz.mx',
        helpUrl: 'https://app.example.test/ayuda',
        privacyUrl: 'https://app.example.test/privacidad',
        termsUrl: 'https://app.example.test/terminos',
      }),
    } as unknown as ConfigService;
    const adapter = new SesEmailDeliveryAdapter(client, config);

    await adapter.sendWelcome({
      email: 'ana@example.test',
      firstName: 'Ana',
      organizationName: 'Despacho Demo',
      locale: 'es-MX',
      timezone: 'America/Mexico_City',
      trialEndsAt: new Date('2026-09-22T18:00:00.000Z'),
    });

    const command = send.mock.calls[0]?.[0];
    expect(command?.input).toMatchObject({
      FromEmailAddress: 'CFDIOS <notifications@cfdios.hemia.dev>',
      Destination: { ToAddresses: ['ana@example.test'] },
      ConfigurationSetName: 'hemia-dev-transactional',
      Content: { Template: { TemplateName: 'cfdios-dev-welcome' } },
    });
    const template = command?.input.Content?.Template;
    if (!template?.TemplateData) throw new Error('Template data was not sent');
    const data = JSON.parse(template.TemplateData) as Record<string, string>;
    expect(Object.keys(data).sort()).toEqual([
      'assetsBaseUrl',
      'first_name',
      'onboardingUrl',
      'organization_name',
      'trial_end_date',
    ]);
    expect(data.first_name).toBe('Ana');
    expect(data.organization_name).toBe('Despacho Demo');
    expect(data.onboardingUrl).toBe('https://app.example.test/es/onboarding');
    expect(data.trial_end_date).toContain('22 de septiembre de 2026');
  });

  it('sends MFA enabled through auth with the required SES variables', async () => {
    const send = jest
      .fn<Promise<{ MessageId: string }>, [SendEmailCommand]>()
      .mockResolvedValue({ MessageId: 'message-id' });
    const client = { send } as unknown as SESv2Client;
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        ses: {
          fromName: 'CFDIOS',
          fromAuth: 'auth@cfdios.hemia.dev',
          replyTo: 'support@hemia.dev',
          configurationSetAuth: 'hemia-dev-auth',
          mfaEnabledTemplate: 'cfdios-dev-mfa-enabled',
        },
        appUrl: 'https://app.example.test',
        assetsBaseUrl: 'https://cdn.example.test',
        helpUrl: 'https://app.example.test/ayuda',
        companyAddress: 'Ciudad de México, México',
      }),
    } as unknown as ConfigService;
    const adapter = new SesEmailDeliveryAdapter(client, config);

    await adapter.sendMfaEnabled({
      email: 'ana@example.test',
      firstName: 'Ana',
      mfaStatus: 'active',
      mfaMethod: 'TOTP',
      activatedAt: new Date('2026-08-23T18:00:00.000Z'),
      deviceName: 'Aplicación autenticadora',
      locale: 'es-MX',
      timezone: 'America/Mexico_City',
    });

    const command = send.mock.calls[0]?.[0];
    if (!command) throw new Error('SES command was not sent');
    expect(command.input).toMatchObject({
      FromEmailAddress: 'CFDIOS <auth@cfdios.hemia.dev>',
      Destination: { ToAddresses: ['ana@example.test'] },
      ConfigurationSetName: 'hemia-dev-auth',
      Content: { Template: { TemplateName: 'cfdios-dev-mfa-enabled' } },
    });
    const template = command.input.Content?.Template;
    if (!template?.TemplateData) throw new Error('Template data was not sent');
    const templateData: unknown = JSON.parse(template.TemplateData);
    if (!templateData || typeof templateData !== 'object') {
      throw new Error('Template data must be an object');
    }
    expect(Object.keys(templateData).sort()).toEqual([
      'activated_at',
      'assetsBaseUrl',
      'company_address',
      'device_name',
      'first_name',
      'mfa_method',
      'mfa_status',
      'reset_password_url',
      'security_settings_url',
      'support_url',
    ]);
    const data = JSON.parse(template.TemplateData) as Record<string, string>;
    expect(data.assetsBaseUrl).toBe('https://cdn.example.test');
    expect(data.security_settings_url).toBe(
      'https://app.example.test/es/security',
    );
    expect(data.reset_password_url).toBe(
      'https://app.example.test/es/forgot-password',
    );
    expect(data.support_url).toBe('https://app.example.test/es/help');
  });

  it('sends MFA disabled with the disabled SES template', async () => {
    const send = jest
      .fn<Promise<{ MessageId: string }>, [SendEmailCommand]>()
      .mockResolvedValue({ MessageId: 'message-id' });
    const client = { send } as unknown as SESv2Client;
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        ses: {
          fromName: 'CFDIOS',
          fromAuth: 'auth@cfdios.hemia.dev',
          replyTo: 'support@hemia.dev',
          configurationSetAuth: 'hemia-dev-auth',
          mfaDisabledTemplate: 'cfdios-dev-mfa-disabled',
        },
        appUrl: 'https://app.example.test',
        assetsBaseUrl: 'https://cdn.example.test',
        companyAddress: 'Ciudad de México, México',
      }),
    } as unknown as ConfigService;
    const adapter = new SesEmailDeliveryAdapter(client, config);

    await adapter.sendMfaDisabled({
      email: 'ana@example.test',
      mfaStatus: 'disabled',
      mfaMethod: 'TOTP',
      activatedAt: new Date('2026-08-23T18:00:00.000Z'),
      deviceName: 'Aplicación autenticadora',
      locale: 'en-US',
    });

    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      FromEmailAddress: 'CFDIOS <auth@cfdios.hemia.dev>',
      Content: { Template: { TemplateName: 'cfdios-dev-mfa-disabled' } },
    });
  });
});
