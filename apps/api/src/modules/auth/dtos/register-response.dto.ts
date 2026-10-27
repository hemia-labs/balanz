export class RegisterResponseDto {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: string;
  organizationStatus: string;
  membershipStatus: string;
  subscriptionType: string;
  subscriptionStatus: string;
  nextStep: 'verify_email';
  mfaRequired: false;
  tenantActive: false;
}
