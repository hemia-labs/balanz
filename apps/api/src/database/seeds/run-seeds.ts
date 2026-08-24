import { AppDataSource } from '../data-source';
import { In } from 'typeorm';
import { Permission } from '../../modules/permissions/entities/permission.entity';
import { RolePermission } from '../../modules/permissions/entities/role-permission.entity';
import {
  Role,
  ROLE_DEFINITIONS,
  RoleKey,
} from '../../modules/permissions/entities/role.entity';
import {
  PERMISSION_CATALOG,
  PERMISSION_METADATA,
  ROLE_PERMISSION_KEYS,
} from '../../common/auth/permission-catalog';

async function seed(): Promise<void> {
  await AppDataSource.transaction(async (manager) => {
    const roles = manager.getRepository(Role);
    await roles.upsert([...ROLE_DEFINITIONS], ['key']);
    const storedRoles = await roles.findBy({
      key: In(Object.values(RoleKey)),
    });
    const roleByKey = new Map(storedRoles.map((role) => [role.key, role.id]));
    const permissions = manager.getRepository(Permission);
    await permissions.upsert(
      PERMISSION_CATALOG.map((key) => ({
        key,
        ...PERMISSION_METADATA[key],
      })),
      ['key'],
    );

    const storedPermissions = await permissions.findBy({
      key: In([...PERMISSION_CATALOG]),
    });
    const permissionByKey = new Map(
      storedPermissions.map((permission) => [permission.key, permission.id]),
    );
    const rolePermissions = manager.getRepository(RolePermission);
    await rolePermissions.delete({
      roleId: In(storedRoles.map((role) => role.id)),
    });
    await rolePermissions.insert(
      Object.entries(ROLE_PERMISSION_KEYS).flatMap(([role, keys]) =>
        keys.map((key) => ({
          roleId: roleByKey.get(role as RoleKey)!,
          permissionId: permissionByKey.get(key)!,
        })),
      ),
    );
  });
}

AppDataSource.initialize()
  .then(seed)
  .then(() => AppDataSource.destroy())
  .catch(async (error: unknown) => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    console.error(error);
    process.exitCode = 1;
  });
