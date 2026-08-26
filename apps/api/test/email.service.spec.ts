import { EmailService } from '../src/modules/email/email.service';
import type { EmailDeliveryPort } from '../src/modules/email/ports/email-delivery.port';

describe('EmailService', () => {
  it('sends verification directly through SES', async () => {
    const delivery = {
      sendVerification: jest.fn().mockResolvedValue(undefined),
    } as unknown as EmailDeliveryPort;
    const service = new EmailService(delivery);
    const input = {
      email: 'ana@example.test',
      firstName: 'Ana',
      token: 'raw-token',
    };

    await service.sendVerification(input);

    expect(delivery.sendVerification).toHaveBeenCalledWith(input);
  });

  it('does not fail a committed registration when SES is unavailable', async () => {
    const delivery = {
      sendVerification: jest.fn().mockRejectedValue(new Error('provider down')),
    } as unknown as EmailDeliveryPort;
    const service = new EmailService(delivery);

    await expect(
      service.sendVerification({
        email: 'ana@example.test',
        token: 'raw-token',
      }),
    ).resolves.toBeUndefined();
  });

  it('sends welcome through the transactional delivery channel', async () => {
    const delivery = {
      sendWelcome: jest.fn().mockResolvedValue(undefined),
    } as unknown as EmailDeliveryPort;
    const service = new EmailService(delivery);
    const input = {
      email: 'ana@example.test',
      firstName: 'Ana',
      organizationName: 'Despacho Demo',
      locale: 'es-MX',
      timezone: 'America/Mexico_City',
      trialEndsAt: new Date('2026-09-22T00:00:00.000Z'),
    };

    await service.sendWelcome(input);

    expect(delivery.sendWelcome).toHaveBeenCalledWith(input);
  });

  it('sends MFA enabled through the auth delivery channel', async () => {
    const delivery = {
      sendMfaEnabled: jest.fn().mockResolvedValue(undefined),
    } as unknown as EmailDeliveryPort;
    const service = new EmailService(delivery);
    const input = {
      email: 'ana@example.test',
      firstName: 'Ana',
      mfaStatus: 'active',
      mfaMethod: 'TOTP',
      activatedAt: new Date('2026-08-23T18:00:00.000Z'),
      deviceName: 'Aplicación autenticadora',
    };

    await service.sendMfaEnabled(input);

    expect(delivery.sendMfaEnabled).toHaveBeenCalledWith(input);
  });

  it('sends MFA disabled through the auth delivery channel', async () => {
    const delivery = {
      sendMfaDisabled: jest.fn().mockResolvedValue(undefined),
    } as unknown as EmailDeliveryPort;
    const service = new EmailService(delivery);
    const input = {
      email: 'ana@example.test',
      mfaStatus: 'disabled',
      mfaMethod: 'TOTP',
      activatedAt: new Date('2026-08-23T18:00:00.000Z'),
      deviceName: 'Aplicación autenticadora',
    };

    await service.sendMfaDisabled(input);

    expect(delivery.sendMfaDisabled).toHaveBeenCalledWith(input);
  });
});
