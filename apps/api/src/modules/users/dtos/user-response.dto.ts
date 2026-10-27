export class UserResponseDto {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  emailVerifiedAt?: Date | null;
  phoneE164?: string | null;
  phoneVerifiedAt?: Date | null;
  locale: string;
  timezone: string;
  status: string;
  membershipStatus?: string;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
