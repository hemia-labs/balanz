import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, In, Repository } from 'typeorm';
import { FindUsersDto } from './dtos/find-users.dto';
import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserDto } from './dtos/update-user.dto';
import { UserResponseDto } from './dtos/user-response.dto';
import { UsersPageResponseDto } from './dtos/users-page-response.dto';
import { User } from './entities/user.entity';
import { UserMapper } from './mappers/user.mapper';
import { PasswordService } from '../../common/auth/password.service';
import { SessionsService } from '../sessions/sessions.service';
import {
  Membership,
  MembershipStatus,
} from '../memberships/entities/membership.entity';
import { Role, RoleKey, RoleScope } from '../permissions/entities/role.entity';

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
    private readonly passwords: PasswordService,
    private readonly dataSource: DataSource,
    @Optional() private readonly sessions?: SessionsService,
  ) {}

  async findAll(
    query: FindUsersDto,
    organizationId: string,
  ): Promise<UsersPageResponseDto> {
    const page = query.page;
    const limit = query.limit;
    const search = query.search?.trim();
    const memberships = await this.memberships.find({
      select: { userId: true },
      where: { organizationId },
    });
    const userIds = memberships.map(({ userId }) => userId);
    if (userIds.length === 0) {
      return {
        items: [],
        meta: { page, limit, total: 0, totalPages: 0 },
      };
    }

    const base = query.status ? { status: query.status } : {};
    const where = search
      ? [
          { ...base, id: In(userIds), firstName: ILike(`%${search}%`) },
          { ...base, id: In(userIds), lastName: ILike(`%${search}%`) },
          { ...base, id: In(userIds), email: ILike(`%${search}%`) },
        ]
      : { ...base, id: In(userIds) };
    const [users, total] = await this.repository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: UserMapper.toDTOList(users),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, organizationId: string): Promise<UserResponseDto> {
    return UserMapper.toDTO(await this.ensureExists(id, organizationId));
  }

  async create(
    dto: CreateUserDto,
    organizationId: string,
  ): Promise<UserResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const memberships = manager.getRepository(Membership);
      const role = await manager.getRepository(Role).findOneByOrFail({
        key: RoleKey.COLLABORATOR,
        scope: RoleScope.ORGANIZATION,
      });
      const user = await users.save(
        users.create({
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email.trim().toLowerCase(),
          passwordHash: await this.passwords.hash(dto.password),
          phoneE164: dto.phoneE164,
          locale: dto.locale ?? 'es-MX',
          timezone: dto.timezone ?? 'America/Mexico_City',
        }),
      );
      await memberships.save(
        memberships.create({
          organizationId,
          userId: user.id,
          roleId: role.id,
          status: MembershipStatus.PENDING,
        }),
      );
      return UserMapper.toDTO(user);
    });
  }

  createForRegistration(
    manager: EntityManager,
    input: RegistrationUserInput,
  ): Promise<User> {
    const repository = manager.getRepository(User);
    return repository.save(repository.create(input));
  }

  async update(
    id: string,
    organizationId: string,
    dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const user = await this.ensureExists(id, organizationId);
    const previousStatus = user.status;
    const passwordChanged = Boolean(dto.password);
    const { password, ...changes } = dto;
    Object.assign(user, {
      ...changes,
      ...(changes.email && { email: changes.email.trim().toLowerCase() }),
    });
    if (password) user.passwordHash = await this.passwords.hash(password);
    const saved = await this.repository.save(user);
    if (passwordChanged || previousStatus !== saved.status) {
      await this.sessions?.revokeUserSessions(
        saved.id,
        passwordChanged ? 'password_changed' : 'user_status_changed',
      );
    }
    return UserMapper.toDTO(saved);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.ensureExists(id, organizationId);
    await this.repository.softDelete(id);
    await this.sessions?.revokeUserSessions(id, 'user_deleted');
  }

  private async ensureExists(
    id: string,
    organizationId: string,
  ): Promise<User> {
    const membership = await this.memberships.findOne({
      where: { organizationId, userId: id },
    });
    if (!membership) throw new NotFoundException('User not found');
    const user = await this.repository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
