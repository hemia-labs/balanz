import { AuthService } from '../src/modules/auth/auth.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Membership } from '../src/modules/memberships/entities/membership.entity';
import { Subscription } from '../src/modules/subscriptions/entities/subscription.entity';

test('an existing member without subscription can sign in without receiving an automatic trial', async () => {
  const find = jest.fn((entity: unknown) =>
    Promise.resolve(
      entity === Subscription
        ? null
        : entity === User
          ? { emailVerifiedAt: new Date() }
          : entity === Membership
            ? { status: 'active' }
            : null,
    ),
  );
  const db = {
    getRepository: (entity: unknown) => ({ findOne: () => find(entity) }),
  };
  const service = new AuthService(
    db as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await expect(
    service.onboarding(
      { userId: 'user', membershipId: 'member' } as never,
      { organizationId: 'org', mfaStatus: 'active' } as never,
    ),
  ).resolves.toEqual({
    subscriptionType: null,
    trial: null,
    nextStep: 'ready',
    mfaStatus: 'active',
  });
  expect(find).toHaveBeenCalledTimes(3);
});
