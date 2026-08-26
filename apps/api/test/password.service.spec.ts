import { BadRequestException } from '@nestjs/common';
import { PasswordService } from '../src/common/auth/password.service';

describe('PasswordService', () => {
  it('hashea y verifica contraseñas con bcrypt', async () => {
    const secrets = { bcrypt_salt_rounds: 4 } as never;
    const service = new PasswordService(secrets);
    const hash = await service.hash('secret123');

    await expect(service.verify('secret123', hash)).resolves.toBe(true);
    await expect(service.verify('wrong', hash)).resolves.toBe(false);
  });

  it('rechaza contraseñas que exceden 72 bytes UTF-8', async () => {
    const service = new PasswordService({ bcrypt_salt_rounds: 4 } as never);
    const password = 'á'.repeat(36);
    const tooLong = `${password}a`;
    const hash = await service.hash(password);

    expect(() => service.hash(tooLong)).toThrow(BadRequestException);
    await expect(service.verify(tooLong, hash)).resolves.toBe(false);
  });
});
