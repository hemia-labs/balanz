import { MembershipStatus } from './entities/membership.entity';

export function canTransitionMembership(
  from: MembershipStatus,
  to: MembershipStatus,
): boolean {
  if (from === MembershipStatus.PENDING) {
    return to === MembershipStatus.ACTIVE || to === MembershipStatus.REVOKED;
  }
  if (from === MembershipStatus.ACTIVE) {
    return to === MembershipStatus.SUSPENDED || to === MembershipStatus.REVOKED;
  }
  if (from === MembershipStatus.SUSPENDED) {
    return to === MembershipStatus.ACTIVE || to === MembershipStatus.REVOKED;
  }
  return false;
}
