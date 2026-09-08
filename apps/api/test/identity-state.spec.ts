import { MembershipStatus } from '../src/modules/memberships/entities/membership.entity';
import { canTransitionMembership } from '../src/modules/memberships/membership-state';
import { canTransitionSubscription } from '../src/modules/subscriptions/subscription-state';
import { SubscriptionStatus } from '../src/modules/subscriptions/entities/subscription.entity';
import { isTenantActive } from '../src/modules/sessions/tenant-access';
import { InvitationStatus } from '../src/modules/invitations/entities/invitation.entity';
import {
  canAcceptInvitation,
  canTransitionInvitation,
} from '../src/modules/invitations/invitation-state';

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
    ).toBe(true);
    expect(
      canTransitionMembership(
        MembershipStatus.REVOKED,
        MembershipStatus.ACTIVE,
      ),
    ).toBe(false);
  });

  it('allows invitation transitions only from pending', () => {
    expect(
      canTransitionInvitation(
        InvitationStatus.PENDING,
        InvitationStatus.ACCEPTED,
      ),
    ).toBe(true);
    expect(
      canTransitionInvitation(
        InvitationStatus.PENDING,
        InvitationStatus.EXPIRED,
      ),
    ).toBe(true);
    expect(
      canTransitionInvitation(
        InvitationStatus.ACCEPTED,
        InvitationStatus.PENDING,
      ),
    ).toBe(false);
    expect(
      canTransitionInvitation(
        InvitationStatus.REVOKED,
        InvitationStatus.ACCEPTED,
      ),
    ).toBe(false);
  });

  it('accepts only a pending invitation before its expiration', () => {
    const now = new Date('2026-09-04T12:00:00.000Z');

    expect(
      canAcceptInvitation(
        InvitationStatus.PENDING,
        new Date('2026-09-04T12:00:01.000Z'),
        now,
      ),
    ).toBe(true);
    expect(canAcceptInvitation(InvitationStatus.PENDING, now, now)).toBe(false);
    expect(
      canAcceptInvitation(
        InvitationStatus.REVOKED,
        new Date('2026-09-04T12:00:01.000Z'),
        now,
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
