import * as dotenv from 'dotenv';
import { DataSource, type EntityManager } from 'typeorm';
import { resolveRuntimeDatabaseCredential } from '../database-options.factory';
import { RuntimeDatabaseGuard } from '../runtime-database-guard.service';
import { resolveScriptDatabaseOptions } from './script-database-options';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const SAFE_ROLE = /^[a-z][a-z0-9_]{1,62}$/;
const FIXED_ROLES = new Set([
  'balanz_api',
  'balanz_worker',
  'balanz_fiscal_owner',
  'balanz_fiscal_cancel_owner',
  'balanz_fiscal_claim_owner',
  'balanz_fiscal_reconcile_owner',
]);

interface ProvisionedPrincipal {
  created: boolean;
  group: 'balanz_api' | 'balanz_worker';
  principal: 'api' | 'worker';
  username: string;
  password: string;
}

async function provisionFiscalRuntimeLogins(): Promise<void> {
  assertSafeEnvironment();
  const options = await resolveScriptDatabaseOptions();
  if (options.type !== 'postgres') {
    throw new Error('Runtime login provisioning requires PostgreSQL');
  }
  const [apiCredential, workerCredential] = await Promise.all([
    resolveRuntimeDatabaseCredential('api'),
    resolveRuntimeDatabaseCredential('worker'),
  ]);
  validateCredentialPair(apiCredential, workerCredential, options);

  const admin = new DataSource({ ...options, logging: false });
  const provisioned: ProvisionedPrincipal[] = [];
  try {
    await admin.initialize();
    const [authority] = await admin.query<
      Array<{
        currentDatabase: string;
        currentUser: string;
        superuser: boolean;
      }>
    >(`
      SELECT
        current_database() AS "currentDatabase",
        current_user AS "currentUser",
        role.rolsuper AS superuser
      FROM pg_roles AS role
      WHERE role.rolname = current_user
    `);
    if (!authority?.superuser) {
      throw new Error(
        'Development runtime provisioning requires the dedicated PostgreSQL superuser/migrator',
      );
    }
    if (
      apiCredential.username === authority.currentUser ||
      workerCredential.username === authority.currentUser
    ) {
      throw new Error('The migrator login cannot be reused at runtime');
    }
    if (
      apiCredential.database !== authority.currentDatabase ||
      workerCredential.database !== authority.currentDatabase
    ) {
      throw new Error(
        'Runtime credentials and migrator must target the same PostgreSQL database',
      );
    }
    const capability = await admin.query<
      Array<{ apiGroup: boolean; workerGroup: boolean; foundation: boolean }>
    >(`
      SELECT
        to_regrole('balanz_api') IS NOT NULL AS "apiGroup",
        to_regrole('balanz_worker') IS NOT NULL AS "workerGroup",
        to_regclass('public.ingestion_jobs') IS NOT NULL AS foundation
    `);
    if (
      !capability[0]?.apiGroup ||
      !capability[0]?.workerGroup ||
      !capability[0]?.foundation
    ) {
      throw new Error(
        'Apply Phase 0 migrations 060/061 before provisioning runtime logins',
      );
    }

    await admin.transaction(async (manager) => {
      provisioned.push(
        await provisionPrincipal(
          manager,
          'api',
          'balanz_api',
          apiCredential.username,
          apiCredential.password,
          authority.currentDatabase,
        ),
      );
      provisioned.push(
        await provisionPrincipal(
          manager,
          'worker',
          'balanz_worker',
          workerCredential.username,
          workerCredential.password,
          authority.currentDatabase,
        ),
      );
    });

    for (const runtime of provisioned) {
      const credential =
        runtime.principal === 'api' ? apiCredential : workerCredential;
      const connection = new DataSource({
        ...options,
        host: credential.host,
        port: credential.port,
        database: credential.database,
        username: credential.username,
        password: credential.password,
        logging: false,
        entities: [],
        migrations: [],
      });
      try {
        await connection.initialize();
        await new RuntimeDatabaseGuard(
          connection,
          runtime.principal,
        ).onApplicationBootstrap();
      } finally {
        if (connection.isInitialized) await connection.destroy();
      }
    }

    console.log(
      JSON.stringify(
        {
          status: 'READY',
          database: authority.currentDatabase,
          credentialsPrinted: false,
          principals: provisioned.map(({ created, group, principal }) => ({
            principal,
            group,
            created,
            runtimeGuard: 'PASSED',
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    if (admin.isInitialized) await admin.destroy();
  }
}

async function provisionPrincipal(
  manager: EntityManager,
  principal: 'api' | 'worker',
  group: 'balanz_api' | 'balanz_worker',
  username: string,
  password: string,
  database: string,
): Promise<ProvisionedPrincipal> {
  const existing = await manager.query<
    Array<{
      canLogin: boolean;
      createDb: boolean;
      createRole: boolean;
      bypassRls: boolean;
      replication: boolean;
      superuser: boolean;
    }>
  >(
    `SELECT
       rolcanlogin AS "canLogin",
       rolcreatedb AS "createDb",
       rolcreaterole AS "createRole",
       rolbypassrls AS "bypassRls",
       rolreplication AS replication,
       rolsuper AS superuser
     FROM pg_roles
     WHERE rolname = $1`,
    [username],
  );
  const role = existing[0];
  if (
    role &&
    (!role.canLogin ||
      role.createDb ||
      role.createRole ||
      role.bypassRls ||
      role.replication ||
      role.superuser)
  ) {
    throw new Error(`Existing ${principal} runtime login has unsafe flags`);
  }
  await assertNoExternalRoleState(manager, username, group);

  const created = !role;
  const roleStatement = await formatStatement(
    manager,
    created
      ? 'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L'
      : 'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
    [username, password],
  );
  await manager.query(roleStatement);
  await manager.query(
    await formatStatement(manager, 'ALTER ROLE %I SET search_path TO public', [
      username,
    ]),
  );

  const membership = await manager.query<
    Array<{ adminOption: boolean; inheritOption: boolean; setOption: boolean }>
  >(
    `SELECT
       membership.admin_option AS "adminOption",
       membership.inherit_option AS "inheritOption",
       membership.set_option AS "setOption"
     FROM pg_auth_members AS membership
     INNER JOIN pg_roles AS granted_role
       ON granted_role.oid = membership.roleid
     INNER JOIN pg_roles AS member_role
       ON member_role.oid = membership.member
     WHERE granted_role.rolname = $1
       AND member_role.rolname = $2`,
    [group, username],
  );
  if (membership.length === 0) {
    await manager.query(
      await formatStatement(
        manager,
        'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
        [group, username],
      ),
    );
  } else if (
    membership[0].adminOption ||
    membership[0].inheritOption ||
    !membership[0].setOption
  ) {
    throw new Error(`Existing ${principal} membership options are unsafe`);
  }
  await manager.query(
    await formatStatement(manager, 'GRANT CONNECT ON DATABASE %I TO %I', [
      database,
      username,
    ]),
  );
  await assertNoExternalRoleState(manager, username, group, true);
  return { created, group, principal, username, password };
}

async function assertNoExternalRoleState(
  manager: EntityManager,
  username: string,
  expectedGroup: string,
  requireExpected = false,
): Promise<void> {
  const [state] = await manager.query<
    Array<{
      expectedMemberships: number;
      memberCount: number;
      ownsDatabase: boolean;
      ownsRelation: boolean;
      directFiscalAcl: boolean;
      canCreateCurrentDatabase: boolean;
      unsafeSchemaCreate: boolean;
      unexpectedMemberships: number;
    }>
  >(
    `SELECT
       count(*) FILTER (WHERE granted_role.rolname = $2)::integer
         AS "expectedMemberships",
       (SELECT count(*)::integer
          FROM pg_auth_members AS child_membership
          INNER JOIN pg_roles AS granted_login
            ON granted_login.oid = child_membership.roleid
         WHERE granted_login.rolname = $1) AS "memberCount",
       EXISTS (
         SELECT 1 FROM pg_database AS database
         INNER JOIN pg_roles AS owner ON owner.oid = database.datdba
         WHERE owner.rolname = $1
       ) AS "ownsDatabase",
       EXISTS (
         SELECT 1 FROM pg_class AS relation
         INNER JOIN pg_roles AS owner ON owner.oid = relation.relowner
         WHERE owner.rolname = $1
       ) AS "ownsRelation",
       (
         EXISTS (
           SELECT 1
           FROM pg_class AS relation
           INNER JOIN pg_namespace AS namespace
             ON namespace.oid = relation.relnamespace
           CROSS JOIN LATERAL aclexplode(relation.relacl) AS access
           INNER JOIN pg_roles AS grantee ON grantee.oid = access.grantee
           WHERE namespace.nspname = 'public'
             AND grantee.rolname = $1
             AND (
               relation.relname IN (
                 'stored_objects', 'ingestion_uploads',
                 'ingestion_jobs', 'ingestion_items', 'audit_events'
               )
               OR (
                 relation.relkind = 'S'
                 AND relation.relname ~ '^(stored_objects|ingestion_|audit_events)'
               )
             )
         )
         OR EXISTS (
           SELECT 1
           FROM pg_attribute AS attribute
           INNER JOIN pg_class AS relation
             ON relation.oid = attribute.attrelid
           INNER JOIN pg_namespace AS namespace
             ON namespace.oid = relation.relnamespace
           CROSS JOIN LATERAL aclexplode(attribute.attacl) AS access
           INNER JOIN pg_roles AS grantee ON grantee.oid = access.grantee
           WHERE namespace.nspname = 'public'
             AND grantee.rolname = $1
             AND attribute.attnum > 0
             AND NOT attribute.attisdropped
             AND relation.relname IN (
               'stored_objects', 'ingestion_uploads',
               'ingestion_jobs', 'ingestion_items', 'audit_events'
             )
         )
         OR EXISTS (
           SELECT 1
           FROM pg_proc AS procedure
           INNER JOIN pg_namespace AS namespace
             ON namespace.oid = procedure.pronamespace
           CROSS JOIN LATERAL aclexplode(procedure.proacl) AS access
           INNER JOIN pg_roles AS grantee ON grantee.oid = access.grantee
           WHERE namespace.nspname = 'public'
             AND grantee.rolname = $1
             AND procedure.proname IN (
               'enforce_stored_object_immutability',
               'mark_ingestion_job_counters_dirty',
               'claim_ingestion_job',
               'ingestion_queue_ages',
               'request_ingestion_job_cancellation',
               'reconcile_fiscal_ingestion_foundation'
             )
         )
         OR EXISTS (
           SELECT 1
           FROM pg_default_acl AS defaults
           CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS access
           INNER JOIN pg_roles AS grantee ON grantee.oid = access.grantee
           WHERE grantee.rolname = $1
             AND defaults.defaclobjtype IN ('r','S','f')
             AND (
               defaults.defaclnamespace = 0::oid
               OR defaults.defaclnamespace = 'public'::regnamespace
             )
         )
       ) AS "directFiscalAcl",
       has_database_privilege($1, current_database(), 'CREATE')
         AS "canCreateCurrentDatabase",
       EXISTS (
         SELECT 1
         FROM pg_namespace AS namespace
         WHERE namespace.nspname <> 'information_schema'
           AND namespace.nspname <> 'pg_catalog'
           AND namespace.nspname !~ '^pg_(toast|temp)'
           AND has_schema_privilege($1, namespace.oid, 'CREATE')
       ) AS "unsafeSchemaCreate",
       count(*) FILTER (
         WHERE granted_role.rolname IS NOT NULL
           AND granted_role.rolname <> $2
       )::integer AS "unexpectedMemberships"
     FROM pg_roles AS login
     LEFT JOIN pg_auth_members AS membership ON membership.member = login.oid
     LEFT JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
     WHERE login.rolname = $1
     GROUP BY login.oid`,
    [username, expectedGroup],
  );
  if (!state) return;
  if (
    state.unexpectedMemberships > 0 ||
    state.memberCount > 0 ||
    state.ownsDatabase ||
    state.ownsRelation ||
    state.directFiscalAcl ||
    state.canCreateCurrentDatabase ||
    state.unsafeSchemaCreate ||
    (requireExpected && state.expectedMemberships !== 1)
  ) {
    throw new Error(
      'Runtime login must have one exclusive group membership and own no database objects',
    );
  }
}

async function formatStatement(
  manager: EntityManager,
  template: string,
  parameters: string[],
): Promise<string> {
  const rows = await manager.query<Array<{ statement: string }>>(
    `SELECT format($1, VARIADIC $2::text[]) AS statement`,
    [template, parameters],
  );
  const statement = rows[0]?.statement;
  if (!statement) throw new Error('Could not build safe PostgreSQL statement');
  return statement;
}

function validateCredentialPair(
  api: Awaited<ReturnType<typeof resolveRuntimeDatabaseCredential>>,
  worker: Awaited<ReturnType<typeof resolveRuntimeDatabaseCredential>>,
  admin: { database?: string; host?: string; port?: number },
): void {
  for (const credential of [api, worker]) {
    if (
      !SAFE_ROLE.test(credential.username) ||
      FIXED_ROLES.has(credential.username)
    ) {
      throw new Error('Runtime login name is invalid or reserved');
    }
    if (credential.password.length < 16) {
      throw new Error(
        'Runtime login passwords must contain at least 16 characters',
      );
    }
    if (
      credential.host !== admin.host ||
      Number(credential.port) !== Number(admin.port) ||
      credential.database !== admin.database
    ) {
      throw new Error(
        'Runtime credentials and migrator must target the same PostgreSQL cluster',
      );
    }
  }
  if (api.username === worker.username || api.password === worker.password) {
    throw new Error('API and worker runtime credentials must be distinct');
  }
}

function assertSafeEnvironment(): void {
  if (
    !['development', 'test'].includes(process.env.NODE_ENV ?? 'development') ||
    process.env.CFDI_PROVISION_RUNTIME_LOGINS !== 'true'
  ) {
    throw new Error(
      'Runtime login provisioning requires development/test and CFDI_PROVISION_RUNTIME_LOGINS=true',
    );
  }
  if (
    process.env.SECRETS_ENABLED === 'true' &&
    (process.env.SECRETS_ENVIRONMENT || 'dev') !== 'dev'
  ) {
    throw new Error(
      'Runtime login provisioning requires the dev secrets scope',
    );
  }
}

void provisionFiscalRuntimeLogins().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Runtime login provisioning failed',
  );
  process.exitCode = 1;
});
