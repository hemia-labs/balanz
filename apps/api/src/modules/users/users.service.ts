import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, In, Repository } from 'typeorm';
import { FindUsersDto } from './dtos/find-users.dto';
import { UserResponseDto } from './dtos/user-response.dto';
import { UsersPageResponseDto } from './dtos/users-page-response.dto';
import { User } from './entities/user.entity';
import { UserMapper } from './mappers/user.mapper';
import { Membership } from '../memberships/entities/membership.entity';

export interface RegistrationUserInput {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  phoneE164?: string;
  locale: string;
  timezone: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
    @InjectRepository(Membership)
    private readonly memberships: Repository<Membership>,
  ) {}

  async findAll(
    query: FindUsersDto,
    organizationId: string,
  ): Promise<UsersPageResponseDto> {
    const page = query.page;
    const limit = query.limit;
    const search = query.search?.trim();
    const memberships = await this.memberships.find({
      select: { userId: true, status: true },
      where: {
        organizationId,
        ...(query.status ? { status: query.status } : {}),
      },
    });
    const userIds = memberships.map(({ userId }) => userId);
    if (userIds.length === 0) {
      return {
        items: [],
        meta: { page, limit, total: 0, totalPages: 0 },
      };
    }

    const where = search
      ? [
          { id: In(userIds), firstName: ILike(`%${search}%`) },
          { id: In(userIds), lastName: ILike(`%${search}%`) },
          { id: In(userIds), email: ILike(`%${search}%`) },
        ]
      : { id: In(userIds) };
    const [users, total] = await this.repository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: UserMapper.toDTOList(
        users,
        new Map(memberships.map(({ userId, status }) => [userId, status])),
      ),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, organizationId: string): Promise<UserResponseDto> {
    const { user, membership } = await this.ensureMember(id, organizationId);
    return UserMapper.toDTO(user, membership.status);
  }

  createForRegistration(
    manager: EntityManager,
    input: RegistrationUserInput,
  ): Promise<User> {
    const repository = manager.getRepository(User);
    return repository.save(repository.create(input));
  }

  private async ensureMember(
    id: string,
    organizationId: string,
    manager?: EntityManager,
  ): Promise<{ user: User; membership: Membership }> {
    const memberships = manager?.getRepository(Membership) ?? this.memberships;
    const users = manager?.getRepository(User) ?? this.repository;
    const membership = await memberships.findOne({
      where: { organizationId, userId: id },
    });
    if (!membership) throw new NotFoundException('User not found');
    const user = await users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return { user, membership };
  }
}
