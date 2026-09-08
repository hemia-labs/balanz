import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FindUsersDto } from '../src/modules/users/dtos/find-users.dto';
import { User } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/users.service';
import {
  Membership,
  MembershipStatus,
} from '../src/modules/memberships/entities/membership.entity';

describe('UsersService', () => {
  it('filtra y pagina usuarios', async () => {
    const repository = {
      findAndCount: jest.fn().mockResolvedValue([[], 41]),
    } as unknown as jest.Mocked<Repository<User>>;
    const membershipRepository = {
      find: jest
        .fn()
        .mockResolvedValue([
          { userId: 'user-1', status: MembershipStatus.ACTIVE },
        ]),
    } as unknown as jest.Mocked<Repository<Membership>>;
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
        {
          provide: getRepositoryToken(Membership),
          useValue: membershipRepository,
        },
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
      select: { userId: true, status: true },
      where: {
        organizationId: 'organization-1',
        status: MembershipStatus.ACTIVE,
      },
    });

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    const options = repository.findAndCount.mock.calls[0][0] as {
      where?: Array<Record<string, unknown>>;
    };
    expect(options.where).toHaveLength(3);
    expect(options.where?.[0]).toHaveProperty('firstName');
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
      ],
    }).compile();

    await expect(
      module.get(UsersService).findOne('user-1', 'organization-2'),
    ).rejects.toThrow('User not found');
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  /* Legacy POST/PUT/DELETE behavior intentionally removed. Membership
     mutations belong exclusively to InvitationsService. */
  it('does not expose legacy membership mutation methods', () => {
    const methods = Object.getOwnPropertyNames(UsersService.prototype);
    expect(methods).not.toEqual(
      expect.arrayContaining(['create', 'update', 'remove']),
    );
  });
});
