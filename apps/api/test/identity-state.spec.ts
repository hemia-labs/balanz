import { MembershipStatus } from '../src/modules/memberships/entities/membership.entity';
import { canTransitionMembership } from '../src/modules/memberships/membership-state';
import { canTransitionSubscription } from '../src/modules/subscriptions/subscription-state';
import { SubscriptionStatus } from '../src/modules/subscriptions/entities/subscription.entity';
import { isTenantActive } from '../src/modules/sessions/tenant-access';

describe('identity state rules', () => {
  it('allows only the defined membership transitions', () => {
    expect(
      canTransitionMembership(
        MembershipStatus.PENDING,
        MembershipStatus.ACTIVE,
      ),
    ).toBe(true);
    expect(
      canTransitionMembership(
        MembershipStatus.PENDING,
        MembershipStatus.REVOKED,
      ),
    ).toBe(false);
    expect(
      canTransitionMembership(
        MembershipStatus.REVOKED,
        MembershipStatus.ACTIVE,
      ),
    ).toBe(false);
  });

  it('activates a subscription only from pending', () => {
    expect(
      canTransitionSubscription(
        SubscriptionStatus.PENDING,
        SubscriptionStatus.TRIALING,
      ),
    ).toBe(true);
    expect(
      canTransitionSubscription(
        SubscriptionStatus.TRIALING,
        SubscriptionStatus.TRIALING,
      ),
    ).toBe(false);
  });

  it('derives tenant access', () => {
    expect(
      isTenantActive({
        userActive: true,
        organizationActive: true,
        membershipActive: true,
        sessionActive: true,
        mfaVerified: true,
      }),
    ).toBe(true);
  });
});
