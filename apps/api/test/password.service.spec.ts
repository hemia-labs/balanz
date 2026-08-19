import { PasswordService } from '../src/common/auth/password.service';

describe('PasswordService', () => {
  it('hashea y verifica contraseñas con bcrypt', async () => {
    const secrets = { bcrypt_salt_rounds: 4 } as never;
    const service = new PasswordService(secrets);
    const hash = await service.hash('secret123');

    await expect(service.verify('secret123', hash)).resolves.toBe(true);
    await expect(service.verify('wrong', hash)).resolves.toBe(false);
  });
});
