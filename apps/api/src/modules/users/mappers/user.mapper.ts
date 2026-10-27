import { UserResponseDto } from '../dtos/user-response.dto';
import { User } from '../entities/user.entity';
import { MembershipStatus } from '../../memberships/entities/membership.entity';

export class UserMapper {
  static toDTO(
    entity: User,
    membershipStatus?: MembershipStatus,
  ): UserResponseDto {
    return {
      id: entity.id,
      firstName: entity.firstName,
      lastName: entity.lastName,
      fullName: `${entity.firstName} ${entity.lastName}`.trim(),
      email: entity.email,
      emailVerifiedAt: entity.emailVerifiedAt,
      phoneE164: entity.phoneE164,
      phoneVerifiedAt: entity.phoneVerifiedAt,
      locale: entity.locale,
      timezone: entity.timezone,
      status: entity.status,
      membershipStatus,
      lastLoginAt: entity.lastLoginAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  static toDTOList(
    entities: User[],
    membershipStatusByUserId?: ReadonlyMap<string, MembershipStatus>,
  ): UserResponseDto[] {
    return entities.map((entity) =>
      this.toDTO(entity, membershipStatusByUserId?.get(entity.id)),
    );
  }
}
