import { MembershipStatus } from '../memberships/entities/membership.entity';
import type { RoleKey } from '../permissions/entities/role.entity';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';

export interface RegistrationResult {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: RoleKey;
  organizationStatus: 'active';
  membershipStatus: MembershipStatus.PENDING;
  subscriptionType: string;
  subscriptionStatus: SubscriptionStatus.PENDING;
  nextStep: 'verify_email';
  mfaRequired: false;
  tenantActive: false;
}

export interface EmailVerificationResult {
  emailVerified: true;
  subscriptionType: string;
  trial: {
    status: SubscriptionStatus;
    startedAt?: Date;
    endsAt?: Date;
  };
  nextStep: 'setup_mfa';
  mfaStatus: 'disabled';
  organizationOwner: boolean;
}
