import {
  MembershipStatus,
  type MembershipRole,
} from '../memberships/entities/membership.entity';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';

export interface RegistrationResult {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: MembershipRole;
  organizationStatus: 'active';
  membershipStatus: MembershipStatus.PENDING;
  subscriptionType: string;
  subscriptionStatus: SubscriptionStatus.PENDING;
  nextStep: 'verify_email';
  mfaRequired: true;
  tenantActive: false;
}

export interface EmailVerificationResult {
  emailVerified: true;
  subscriptionType: string;
  trial: {
    status: SubscriptionStatus.TRIALING;
    startedAt: Date;
    endsAt: Date;
  };
  nextStep: 'complete_mfa';
}
