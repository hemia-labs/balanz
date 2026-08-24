import { BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  it('conserva el código funcional de un error HTTP', () => {
    const json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/api/v1/auth/mfa/totp/verify' }),
      }),
    } as never;

    new AllExceptionsFilter().catch(
      new BadRequestException({
        code: 'MFA_INVALID_CODE',
        message: 'El código MFA no es válido o ha expirado.',
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'MFA_INVALID_CODE',
        message: 'El código MFA no es válido o ha expirado.',
      }),
    );
  });
});
