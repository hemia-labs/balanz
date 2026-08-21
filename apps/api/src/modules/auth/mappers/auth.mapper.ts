import { RegisterResponseDto } from '../dtos/register-response.dto';
import { RegistrationResult } from '../auth.types';

export class AuthMapper {
  static toRegisterResponse(result: RegistrationResult): RegisterResponseDto {
    return {
      userId: result.userId,
      organizationId: result.organizationId,
      membershipId: result.membershipId,
      role: result.role,
      organizationStatus: result.organizationStatus,
      membershipStatus: result.membershipStatus,
      subscriptionType: result.subscriptionType,
      subscriptionStatus: result.subscriptionStatus,
      nextStep: result.nextStep,
      mfaRequired: true,
      tenantActive: result.tenantActive,
    };
  }
}
