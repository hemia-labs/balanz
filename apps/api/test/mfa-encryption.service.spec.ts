import { ConfigService } from '@nestjs/config';
import { MfaEncryptionService } from '../src/modules/auth/mfa-encryption.service';

describe('MfaEncryptionService', () => {
  it('round-trips and rejects tampering', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'auth.mfaEncryptionKey')
          return Buffer.alloc(32, 7).toString('base64');
        return fallback;
      }),
    } as unknown as ConfigService;
    const service = new MfaEncryptionService(config, {} as never);
    const encrypted = await service.encrypt('JBSWY3DPEHPK3PXP');
    await expect(service.decrypt(encrypted)).resolves.toBe('JBSWY3DPEHPK3PXP');
    const parts = encrypted.split(':');
    const replacement = parts[3].startsWith('A') ? 'B' : 'A';
    parts[3] = `${replacement}${parts[3].slice(1)}`;
    const tampered = parts.join(':');
    await expect(service.decrypt(tampered)).rejects.toThrow();
  });
});
