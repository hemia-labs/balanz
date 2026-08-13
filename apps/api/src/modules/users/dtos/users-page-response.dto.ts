import { UserResponseDto } from './user-response.dto';

export class UsersPageResponseDto {
  items: UserResponseDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
