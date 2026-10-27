import { In, type DataSource } from 'typeorm';
import {
  PERMISSION_CATALOG,
  PermissionStatus,
  ROLE_PERMISSION_KEYS,
  permissionDefinition,
} from '../../common/auth/permission-catalog';
import { Permission } from '../../modules/permissions/entities/permission.entity';
import { RolePermission } from '../../modules/permissions/entities/role-permission.entity';
import {
  Role,
  ROLE_DEFINITIONS,
  RoleKey,
} from '../../modules/permissions/entities/role.entity';

export async function seedDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (manager) => {
    const roles = manager.getRepository(Role);
    await roles
      .createQueryBuilder()
      .insert()
      .values([...ROLE_DEFINITIONS])
      .orIgnore()
      .execute();
    for (const definition of ROLE_DEFINITIONS) {
      await roles.update(
        { key: definition.key },
        {
          name: definition.name,
          description: definition.description,
          scope: definition.scope,
        },
      );
    }
    const storedRoles = await roles.findBy({
      key: In(Object.values(RoleKey)),
    });
    const roleByKey = new Map(storedRoles.map((role) => [role.key, role.id]));
    const permissions = manager.getRepository(Permission);
    await permissions.upsert(
      PERMISSION_CATALOG.map((key) => ({
        key,
        ...permissionDefinition(key),
        status: PermissionStatus.ACTIVE,
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
    await rolePermissions.update(
      { roleId: In(storedRoles.map((role) => role.id)) },
      { enabled: false },
    );
    await rolePermissions.upsert(
      Object.entries(ROLE_PERMISSION_KEYS).flatMap(([role, keys]) =>
        keys.map((key) => ({
          roleId: roleByKey.get(role as RoleKey)!,
          permissionId: permissionByKey.get(key)!,
          enabled: true,
        })),
      ),
      ['role', 'permissionId'],
    );
  });
}
