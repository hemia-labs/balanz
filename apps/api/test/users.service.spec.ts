import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PasswordService } from '../src/common/auth/password.service';
import { FindUsersDto } from '../src/modules/users/dtos/find-users.dto';
import { User } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/users.service';

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
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
        {
          provide: PasswordService,
          useValue: { hash: jest.fn().mockResolvedValue('hash') },
        },
      ],
    }).compile();

    const result = await module.get(UsersService).create({
      firstName: 'Ana',
      lastName: 'López',
      email: 'ana@example.com',
      password: 'secret123',
    });

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
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('filtra y pagina usuarios', async () => {
    const repository = {
      findAndCount: jest.fn().mockResolvedValue([[], 41]),
    } as unknown as jest.Mocked<Repository<User>>;
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
        { provide: PasswordService, useValue: { hash: jest.fn() } },
      ],
    }).compile();

    const result = await module.get(UsersService).findAll({
      search: 'ana',
      status: 'active',
      page: 3,
      limit: 10,
    } as FindUsersDto);

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    const options = repository.findAndCount.mock.calls[0][0];
    expect(options.where).toHaveLength(3);
    expect(options.where?.[0]).toEqual(
      expect.objectContaining({ status: 'active' }),
    );
    expect(result.meta).toEqual({
      page: 3,
      limit: 10,
      total: 41,
      totalPages: 5,
    });
  });
});
