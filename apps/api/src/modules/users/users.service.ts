import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, Repository } from 'typeorm';
import { FindUsersDto } from './dtos/find-users.dto';
import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserDto } from './dtos/update-user.dto';
import { UserResponseDto } from './dtos/user-response.dto';
import { UsersPageResponseDto } from './dtos/users-page-response.dto';
import { User } from './entities/user.entity';
import { UserMapper } from './mappers/user.mapper';
import { PasswordService } from '../../common/auth/password.service';
import { SessionsService } from '../sessions/sessions.service';

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
    private readonly passwords: PasswordService,
    @Optional() private readonly sessions?: SessionsService,
  ) {}

  async findAll(query: FindUsersDto): Promise<UsersPageResponseDto> {
    const page = query.page;
    const limit = query.limit;
    const search = query.search?.trim();
    const base = query.status ? { status: query.status } : {};
    const where = search
      ? [
          { ...base, firstName: ILike(`%${search}%`) },
          { ...base, lastName: ILike(`%${search}%`) },
          { ...base, email: ILike(`%${search}%`) },
        ]
      : base;
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

  async findOne(id: string): Promise<UserResponseDto> {
    return UserMapper.toDTO(await this.ensureExists(id));
  }

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const user = this.repository.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email.trim().toLowerCase(),
      passwordHash: await this.passwords.hash(dto.password),
      phoneE164: dto.phoneE164,
      locale: dto.locale,
      timezone: dto.timezone,
    });
    return UserMapper.toDTO(await this.repository.save(user));
  }

  createForRegistration(
    manager: EntityManager,
    input: RegistrationUserInput,
  ): Promise<User> {
    const repository = manager.getRepository(User);
    return repository.save(repository.create(input));
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.ensureExists(id);
    const previousStatus = user.status;
    const { password, ...changes } = dto;
    Object.assign(user, {
      ...changes,
      ...(changes.email && { email: changes.email.trim().toLowerCase() }),
    });
    if (password) user.passwordHash = await this.passwords.hash(password);
    const saved = await this.repository.save(user);
    if (previousStatus !== saved.status) {
      await this.sessions?.invalidateByUser(saved.id);
    }
    return UserMapper.toDTO(saved);
  }

  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.repository.softDelete(id);
    await this.sessions?.invalidateByUser(id);
  }

  private async ensureExists(id: string): Promise<User> {
    const user = await this.repository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
