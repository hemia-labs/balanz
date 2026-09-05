import { InvitationStatus } from './entities/invitation.entity';

export function canTransitionInvitation(
  from: InvitationStatus,
  to: InvitationStatus,
): boolean {
  return (
    from === InvitationStatus.PENDING &&
    (to === InvitationStatus.ACCEPTED ||
      to === InvitationStatus.EXPIRED ||
      to === InvitationStatus.REVOKED)
  );
}

export function canAcceptInvitation(
  status: InvitationStatus,
  expiresAt: Date,
  now: Date = new Date(),
): boolean {
  return (
    status === InvitationStatus.PENDING && expiresAt.getTime() > now.getTime()
  );
}
