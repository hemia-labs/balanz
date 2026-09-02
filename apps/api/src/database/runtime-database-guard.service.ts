import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

export const DATABASE_RUNTIME_PRINCIPAL = Symbol('DATABASE_RUNTIME_PRINCIPAL');
export type DatabaseRuntimePrincipal = 'api' | 'worker';

interface PrincipalRow {
  current_user: string;
  session_user: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcanlogin: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolinherit: boolean;
  expected_member: boolean;
  direct_membership_count: number;
  expected_direct_admin_option: boolean;
  expected_direct_inherit_option: boolean;
  expected_direct_set_option: boolean;
  unexpected_role_count: number;
  reachable_privileged_role: boolean;
  reachable_admin_option: boolean;
  owns_current_database: boolean;
  owns_fiscal_relation: boolean;
  direct_fiscal_acl: boolean;
  can_create_current_database: boolean;
  safe_search_path: boolean;
  unsafe_schema_create: boolean;
}

/** Fails boot if a runtime process receives migrator/BYPASSRLS authority. */
@Injectable()
export class RuntimeDatabaseGuard implements OnApplicationBootstrap {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(DATABASE_RUNTIME_PRINCIPAL)
    private readonly principal: DatabaseRuntimePrincipal,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const expected = this.principal === 'api' ? 'balanz_api' : 'balanz_worker';
    const rows = await this.dataSource.query<PrincipalRow[]>(
      `WITH RECURSIVE reachable AS (
         SELECT role.oid, role.rolname, role.rolsuper, role.rolbypassrls,
                role.rolcreatedb, role.rolcreaterole, role.rolreplication
         FROM pg_roles AS role
         WHERE role.rolname = session_user
         UNION
         SELECT parent.oid, parent.rolname, parent.rolsuper, parent.rolbypassrls,
                parent.rolcreatedb, parent.rolcreaterole, parent.rolreplication
         FROM reachable AS child
         JOIN pg_auth_members AS membership ON membership.member = child.oid
         JOIN pg_roles AS parent ON parent.oid = membership.roleid
       ), login AS (
         SELECT role.*
         FROM pg_roles AS role
         WHERE role.rolname = session_user
       )
       SELECT
         current_user,
         session_user,
         login.rolsuper,
         login.rolbypassrls,
         login.rolcanlogin,
         login.rolcreatedb,
         login.rolcreaterole,
         login.rolreplication,
         login.rolinherit,
         EXISTS (SELECT 1 FROM reachable WHERE rolname = $1) AS expected_member,
         (
           SELECT count(*)::integer
           FROM pg_auth_members AS direct_membership
           WHERE direct_membership.member = login.oid
         ) AS direct_membership_count,
         COALESCE((
           SELECT direct_membership.admin_option
           FROM pg_auth_members AS direct_membership
           INNER JOIN pg_roles AS granted_role
             ON granted_role.oid = direct_membership.roleid
           WHERE direct_membership.member = login.oid
             AND granted_role.rolname = $1
         ), true) AS expected_direct_admin_option,
         COALESCE((
           SELECT direct_membership.inherit_option
           FROM pg_auth_members AS direct_membership
           INNER JOIN pg_roles AS granted_role
             ON granted_role.oid = direct_membership.roleid
           WHERE direct_membership.member = login.oid
             AND granted_role.rolname = $1
         ), true) AS expected_direct_inherit_option,
         COALESCE((
           SELECT direct_membership.set_option
           FROM pg_auth_members AS direct_membership
           INNER JOIN pg_roles AS granted_role
             ON granted_role.oid = direct_membership.roleid
           WHERE direct_membership.member = login.oid
             AND granted_role.rolname = $1
         ), false) AS expected_direct_set_option,
          (
            SELECT count(*)::integer
            FROM reachable
            WHERE rolname <> session_user AND rolname <> $1
          ) AS unexpected_role_count,
          EXISTS (
            SELECT 1 FROM reachable
           WHERE rolname <> session_user
             AND (
               rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole
               OR rolreplication
             )
          ) AS reachable_privileged_role,
          EXISTS (
            SELECT 1
            FROM pg_auth_members AS membership
            INNER JOIN reachable AS child ON child.oid = membership.member
            WHERE membership.admin_option
          ) AS reachable_admin_option,
         EXISTS (
           SELECT 1 FROM pg_database
           WHERE datname = current_database()
             AND datdba IN (SELECT oid FROM reachable)
         ) AS owns_current_database,
         EXISTS (
           SELECT 1
           FROM pg_class AS relation
           JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
           JOIN reachable ON reachable.oid = relation.relowner
           WHERE namespace.nspname = 'public'
             AND relation.relname IN (
               'stored_objects', 'ingestion_uploads',
               'ingestion_jobs', 'ingestion_items'
             )
         ) AS owns_fiscal_relation,
         (
           EXISTS (
             SELECT 1
             FROM pg_class AS relation
             JOIN pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
              CROSS JOIN LATERAL aclexplode(relation.relacl) AS access
             WHERE namespace.nspname = 'public'
               AND access.grantee = login.oid
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
             WHERE namespace.nspname = 'public'
               AND access.grantee = login.oid
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
             JOIN pg_namespace AS namespace
               ON namespace.oid = procedure.pronamespace
              CROSS JOIN LATERAL aclexplode(procedure.proacl) AS access
             WHERE namespace.nspname = 'public'
               AND access.grantee = login.oid
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
             WHERE access.grantee = login.oid
               AND defaults.defaclobjtype IN ('r','S','f')
               AND (
                 defaults.defaclnamespace = 0::oid
                 OR defaults.defaclnamespace = 'public'::regnamespace
               )
           )
         ) AS direct_fiscal_acl,
         -- CREATE enables attacker-controlled schemas and is never needed by
         -- runtime. TEMP remains PostgreSQL's default PUBLIC capability; do
         -- not mutate that cluster-wide ACL here. Fixed search_path plus the
         -- direct fiscal ACL checks above keep it outside fiscal resolution.
         has_database_privilege(
           session_user,
           current_database(),
           'CREATE'
         ) AS can_create_current_database,
         current_schemas(false) = ARRAY['public']::name[] AS safe_search_path,
         EXISTS (
           SELECT 1
           FROM pg_namespace AS namespace
           WHERE namespace.nspname <> 'information_schema'
             AND namespace.nspname <> 'pg_catalog'
             AND namespace.nspname !~ '^pg_(toast|temp)'
             AND has_schema_privilege(session_user, namespace.oid, 'CREATE')
         ) AS unsafe_schema_create
       FROM login`,
      [expected],
    );
    const row = rows[0];
    const violations = this.principalViolations(row);
    if (violations.length > 0) {
      throw this.unsafePrincipal(expected, violations);
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.query(`SET LOCAL ROLE ${expected}`);
        const verification =
          await manager.query<Array<{ current_user: string }>>(
            `SELECT current_user`,
          );
        if (verification[0]?.current_user !== expected) {
          throw new Error('SET LOCAL ROLE did not select the expected group');
        }
        await manager.query(`RESET ROLE`);
      });
    } catch {
      throw this.unsafePrincipal(expected);
    }
  }

  private principalViolations(row: PrincipalRow | undefined): string[] {
    if (!row) return ['principal_not_found'];

    return [
      [row.current_user !== row.session_user, 'set_role_session'],
      [row.rolsuper, 'superuser'],
      [row.rolbypassrls, 'bypass_rls'],
      [!row.rolcanlogin, 'no_login'],
      [row.rolcreatedb, 'create_database'],
      [row.rolcreaterole, 'create_role'],
      [row.rolreplication, 'replication'],
      [row.rolinherit, 'inherit'],
      [!row.expected_member, 'missing_expected_membership'],
      [row.direct_membership_count !== 1, 'nonexclusive_membership'],
      [row.expected_direct_admin_option, 'membership_admin_option'],
      [row.expected_direct_inherit_option, 'membership_inherit_option'],
      [!row.expected_direct_set_option, 'missing_membership_set_option'],
      [row.unexpected_role_count > 0, 'unexpected_reachable_role'],
      [row.reachable_privileged_role, 'reachable_privileged_role'],
      [row.reachable_admin_option, 'reachable_admin_option'],
      [row.owns_current_database, 'database_owner'],
      [row.owns_fiscal_relation, 'fiscal_relation_owner'],
      [row.direct_fiscal_acl, 'direct_fiscal_acl'],
      [row.can_create_current_database, 'database_create'],
      [!row.safe_search_path, 'unsafe_search_path'],
      [row.unsafe_schema_create, 'schema_create'],
    ]
      .filter(([violated]) => violated)
      .map(([, code]) => String(code));
  }

  private unsafePrincipal(expected: string, violations: string[] = []): Error {
    const suffix =
      violations.length > 0 ? `; violations=${violations.join(',')}` : '';
    return new Error(
      `Unsafe ${this.principal} PostgreSQL runtime principal; a dedicated LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS role with one exclusive ${expected} membership (ADMIN false, INHERIT false, SET true) is required${suffix}`,
    );
  }
}
