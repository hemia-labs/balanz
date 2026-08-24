import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PasswordService } from '../src/common/auth/password.service';
import { FindUsersDto } from '../src/modules/users/dtos/find-users.dto';
import { User } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/users.service';
import {
  Membership,
  MembershipRole,
  MembershipStatus,
} from '../src/modules/memberships/entities/membership.entity';

describe('UsersService', () => {
  it('crea usuarios sin devolver ni guardar la contraseña en claro', async () => {
    const user = {
      id: '1',
      firstName: 'Ana',
      lastName: 'López',
      email: 'ana@example.com',
      passwordHash: 'salt:hash',
      locale: 'es-MX',
      timezone: 'America/Mexico_City',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User;
    const repository = {
      create: jest.fn().mockReturnValue(user),
      save: jest.fn().mockResolvedValue(user),
    } as unknown as jest.Mocked<Repository<User>>;
    const membershipRepository = {
      create: jest.fn((value: Partial<Membership>) => value as Membership),
      save: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<Repository<Membership>>;
    const manager = {
      getRepository: jest.fn((entity: typeof User | typeof Membership) =>
        entity === User ? repository : membershipRepository,
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
        {
          provide: getRepositoryToken(Membership),
          useValue: membershipRepository,
        },
        {
          provide: PasswordService,
          useValue: { hash: jest.fn().mockResolvedValue('hash') },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(
              (callback: (value: typeof manager) => unknown) =>
                Promise.resolve(callback(manager)),
            ),
          },
        },
      ],
    }).compile();

    const result = await module.get(UsersService).create(
      {
        firstName: 'Ana',
        lastName: 'López',
        email: 'ana@example.com',
        password: 'secret123',
      },
      'organization-1',
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Ana',
        lastName: 'López',
        email: 'ana@example.com',
      }),
    );
    expect(repository.create.mock.calls[0][0].passwordHash).not.toBe(
      'secret123',
    );
    expect(membershipRepository.create).toHaveBeenCalledWith({
      organizationId: 'organization-1',
      userId: '1',
      role: MembershipRole.COLLABORATOR,
      status: MembershipStatus.PENDING,
    });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('filtra y pagina usuarios', async () => {
    const repository = {
      findAndCount: jest.fn().mockResolvedValue([[], 41]),
    } as unknown as jest.Mocked<Repository<User>>;
    const membershipRepository = {
      find: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
    } as unknown as jest.Mocked<Repository<Membership>>;
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
        {
          provide: getRepositoryToken(Membership),
          useValue: membershipRepository,
        },
        { provide: PasswordService, useValue: { hash: jest.fn() } },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();

    const result = await module.get(UsersService).findAll(
      {
        search: 'ana',
        status: 'active',
        page: 3,
        limit: 10,
      } as FindUsersDto,
      'organization-1',
    );

    expect(membershipRepository.find).toHaveBeenCalledWith({
      select: { userId: true },
      where: { organizationId: 'organization-1' },
    });

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    const options = repository.findAndCount.mock.calls[0][0] as {
      where?: Array<Record<string, unknown>>;
    };
    expect(options.where).toHaveLength(3);
    expect(options.where?.[0]).toEqual(
      expect.objectContaining({
        status: 'active',
      }),
    );
    expect(result.meta).toEqual({
      page: 3,
      limit: 10,
      total: 41,
      totalPages: 5,
    });
  });

  it('does not expose a user outside the active organization', async () => {
    const repository = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<User>>;
    const membershipRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<Repository<Membership>>;
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
        {
          provide: getRepositoryToken(Membership),
          useValue: membershipRepository,
        },
        { provide: PasswordService, useValue: { hash: jest.fn() } },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();

    await expect(
      module.get(UsersService).findOne('user-1', 'organization-2'),
    ).rejects.toThrow('User not found');
    expect(repository.findOne).not.toHaveBeenCalled();
  });
});
