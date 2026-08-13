import { ConfigService } from '@nestjs/config';
import { PasswordService } from '../src/common/auth/password.service';

describe('PasswordService', () => {
  it('hashea y verifica contraseñas con bcrypt', async () => {
    const config = {
      getOrThrow: jest.fn().mockReturnValue(4),
    } as unknown as ConfigService;
    const service = new PasswordService(config);
    const hash = await service.hash('secret123');

    await expect(service.verify('secret123', hash)).resolves.toBe(true);
    await expect(service.verify('wrong', hash)).resolves.toBe(false);
  });
});
