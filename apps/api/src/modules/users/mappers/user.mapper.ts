import { UserResponseDto } from '../dtos/user-response.dto';
import { User } from '../entities/user.entity';

export class UserMapper {
  static toDTO(entity: User): UserResponseDto {
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
      lastLoginAt: entity.lastLoginAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  static toDTOList(entities: User[]): UserResponseDto[] {
    return entities.map((entity) => this.toDTO(entity));
  }
}
