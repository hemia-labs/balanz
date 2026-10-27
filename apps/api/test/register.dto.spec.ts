import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from '../src/modules/auth/dtos/register.dto';

const validRegistration = {
  firstName: 'Ana',
  lastName: 'López',
  email: 'ana@example.test',
  password: 'secret123',
  organizationName: 'Demo',
  slug: 'demo',
  subscriptionType: 'trial',
};

describe('RegisterDto', () => {
  it('normalizes canonical fields before validation', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...validRegistration,
      email: ' ANA@EXAMPLE.TEST ',
      slug: ' Demo-Slug ',
      timezone: ' America/Mexico_City ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.email).toBe('ana@example.test');
    expect(dto.slug).toBe('demo-slug');
    expect(dto.timezone).toBe('America/Mexico_City');
  });

  it('rejects invalid user and organization timezones', async () => {
    const errors = await validate(
      plainToInstance(RegisterDto, {
        ...validRegistration,
        timezone: 'not/a-real-zone',
        organizationTimezone: 'also/invalid',
      }),
    );

    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining(['timezone', 'organizationTimezone']),
    );
  });
});
