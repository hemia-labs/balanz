import { isJwtSecrets } from '../src/common/auth/types/jwt.types';

describe('JWT secret type', () => {
  it('accepts the auth/jwt response', () => {
    expect(
      isJwtSecrets({
        bcrypt_salt_rounds: 12,
        cookie_secure: false,
        jwt_expires_in: '15m',
        jwt_refresh_expires_in: '7d',
        jwt_refresh_secret: 'r'.repeat(16),
        jwt_secret: 's'.repeat(16),
      }),
    ).toBe(true);
  });
});
