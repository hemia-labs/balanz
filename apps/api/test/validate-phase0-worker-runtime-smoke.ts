import { createSecretsClient, type SecretsScope } from '@hemia/secrets';
import { Client } from 'pg';
import { isDatabaseSecret } from '../src/database/types/database.types';

interface WorkerHealth {
  status?: unknown;
  process?: unknown;
  dependencies?: {
    workerSupervisor?: {
      status?: unknown;
      state?: unknown;
      acceptingClaims?: unknown;
    };
    redisWakeup?: {
      status?: unknown;
      required?: unknown;
    };
  };
  workerSupervisor?: {
    status?: unknown;
    state?: unknown;
    acceptingClaims?: unknown;
  };
}

interface PrincipalState {
  current_user: string;
  session_user: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolinherit: boolean;
  expected_member: boolean;
  direct_membership_count: number;
  admin_option: boolean;
  inherit_option: boolean;
  set_option: boolean;
  can_execute_queue_ages: boolean;
  can_execute_claim: boolean;
  can_execute_reconcile: boolean;
  can_execute_legacy_queue_ages: boolean;
  can_execute_legacy_claim: boolean;
  can_execute_legacy_reconcile: boolean;
  can_read_users: boolean;
  delete_privilege_count: number;
  sequence_privilege_count: number;
}

const scope: SecretsScope = {
  environment: 'dev',
  category: 'internal',
  owner: 'balanz',
  system: 'api',
};

async function validateWorkerRuntime(): Promise<void> {
  assertOptIn();
  await validateWorkerHealth();

  const secrets = createSecretsClient({
    scope,
    provider: {
      type: 'hashicorp-vault',
      options: {
        baseUrl: requiredEnvironment('VAULT_BASE_URL'),
        roleId: requiredEnvironment('VAULT_ROLE_ID'),
        secretId: requiredEnvironment('VAULT_SECRET_ID'),
        authPath: requiredEnvironment('VAULT_AUTH_PATH'),
        mountPrefix: requiredEnvironment('VAULT_MOUNT_PREFIX'),
        timeoutMs: 5_000,
      },
    },
    cache: { enabled: false, ttlMs: 1 },
  });
  const database = await secrets.getRequired('database/postgres-worker');
  assert(isDatabaseSecret(database), 'worker database secret shape');

  const client = new Client({
    host: database.db_host,
    port: database.db_port,
    database: database.db_database,
    user: database.db_username,
    password: database.db_password,
    options:
      '-c timezone=America/Mexico_City -c search_path=public -c role=balanz_worker',
  });
  await client.connect();
  try {
    const principal = await client.query<PrincipalState>(`
      SELECT
        current_user,
        session_user,
        login.rolsuper,
        login.rolbypassrls,
        login.rolcreatedb,
        login.rolcreaterole,
        login.rolreplication,
        login.rolinherit,
        pg_has_role(session_user, 'balanz_worker', 'MEMBER') AS expected_member,
        (
          SELECT count(*)::integer
          FROM pg_auth_members AS membership
          WHERE membership.member = login.oid
        ) AS direct_membership_count,
        membership.admin_option,
        membership.inherit_option,
        membership.set_option,
        has_function_privilege(
          current_user,
          'public.ingestion_queue_ages(text[],integer,integer)',
          'EXECUTE'
        ) AS can_execute_queue_ages,
        has_function_privilege(
          current_user,
          'public.claim_ingestion_job(text,text,text[],integer,integer,integer,integer)',
          'EXECUTE'
        ) AS can_execute_claim,
        has_function_privilege(
          current_user,
          'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer,integer)',
          'EXECUTE'
        ) AS can_execute_reconcile,
        has_function_privilege(
          current_user,
          'public.ingestion_queue_ages(text[],integer)',
          'EXECUTE'
        ) AS can_execute_legacy_queue_ages,
        has_function_privilege(
          current_user,
          'public.claim_ingestion_job(text,text,text[],integer,integer,integer)',
          'EXECUTE'
        ) AS can_execute_legacy_claim,
        has_function_privilege(
          current_user,
          'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer)',
          'EXECUTE'
        ) AS can_execute_legacy_reconcile,
        has_table_privilege(current_user, 'public.users', 'SELECT') AS can_read_users,
        (
          SELECT count(*)::integer
          FROM pg_class AS relation
          INNER JOIN pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND relation.relkind IN ('r', 'p')
            AND has_table_privilege(current_user, relation.oid, 'DELETE')
        ) AS delete_privilege_count,
        (
          SELECT count(*)::integer
          FROM pg_class AS sequence
          INNER JOIN pg_namespace AS namespace
            ON namespace.oid = sequence.relnamespace
          WHERE namespace.nspname = 'public'
            AND sequence.relkind = 'S'
            AND (
              has_sequence_privilege(current_user, sequence.oid, 'USAGE')
              OR has_sequence_privilege(current_user, sequence.oid, 'SELECT')
              OR has_sequence_privilege(current_user, sequence.oid, 'UPDATE')
            )
        ) AS sequence_privilege_count
      FROM pg_roles AS login
      INNER JOIN pg_auth_members AS membership
        ON membership.member = login.oid
      INNER JOIN pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
       AND granted_role.rolname = 'balanz_worker'
      WHERE login.rolname = session_user
    `);
    const row = principal.rows[0];
    assert(row, 'worker principal row');
    assert(
      row.current_user === 'balanz_worker' &&
        row.session_user === database.db_username,
      'worker LOGIN selects the closed runtime group at connection startup',
    );
    assert(
      !row.rolsuper &&
        !row.rolbypassrls &&
        !row.rolcreatedb &&
        !row.rolcreaterole &&
        !row.rolreplication &&
        !row.rolinherit,
      'worker LOGIN safety flags',
    );
    assert(
      row.expected_member &&
        row.direct_membership_count === 1 &&
        !row.admin_option &&
        !row.inherit_option &&
        row.set_option,
      'exclusive selectable worker membership with INHERIT FALSE',
    );
    assert(
      row.can_execute_queue_ages &&
        row.can_execute_claim &&
        row.can_execute_reconcile,
      'worker inherited durable-function ACL',
    );
    assert(
      !row.can_execute_legacy_queue_ages &&
        !row.can_execute_legacy_claim &&
        !row.can_execute_legacy_reconcile,
      'worker legacy durable-function ACLs remain revoked',
    );
    assert(!row.can_read_users, 'worker cannot read application users');
    assert(row.delete_privilege_count === 0, 'worker has no DELETE privilege');
    assert(
      row.sequence_privilege_count === 0,
      'worker has no public sequence privilege',
    );

    // This is the same read-only durable queue function exercised by the real
    // worker repository. Phase 0 intentionally has no production job handler,
    // so the smoke must not manufacture or claim a fake production job type.
    await client.query(
      `SELECT * FROM public.ingestion_queue_ages($1::text[], $2, $3)`,
      [['manual_xml'], 4, 3],
    );
  } finally {
    await client.end();
  }

  console.log(
    JSON.stringify({
      status: 'PASS',
      entrypoint: 'dist/worker.js',
      supervisor: 'RUNNING_AND_ACCEPTING',
      databasePrincipal: 'DEDICATED_LOGIN_NOINHERIT_SET_ROLE_BALANZ_WORKER',
      durableQueueFunction: 'EXECUTED',
      redis: expectRedisUnavailable() ? 'UNAVAILABLE_POLLING_ACTIVE' : 'UP',
      secretValuesPrinted: false,
    }),
  );
}

async function validateWorkerHealth(): Promise<void> {
  const liveness = await health('liveness');
  const liveSupervisor = liveness.workerSupervisor;
  assert(
    liveness.status === 'up' &&
      liveness.process === 'worker' &&
      liveSupervisor?.status === 'up' &&
      liveSupervisor.state === 'running' &&
      liveSupervisor.acceptingClaims === true,
    'worker liveness and supervisor',
  );

  const readiness = await health('readiness');
  const readySupervisor = readiness.dependencies?.workerSupervisor;
  const redisWakeup = readiness.dependencies?.redisWakeup;
  const expectedReadiness = expectRedisUnavailable() ? 'degraded' : 'up';
  assert(
    readiness.status === expectedReadiness &&
      readiness.process === 'worker' &&
      readySupervisor?.status === 'up' &&
      readySupervisor.state === 'running' &&
      readySupervisor.acceptingClaims === true,
    'worker readiness and supervisor',
  );
  assert(
    redisWakeup?.required === false &&
      redisWakeup.status === (expectRedisUnavailable() ? 'down' : 'up'),
    'best-effort Redis readiness state',
  );
}

async function health(
  endpoint: 'liveness' | 'readiness',
): Promise<WorkerHealth> {
  const response = await fetch(`http://127.0.0.1:3002/${endpoint}`);
  assert(response.ok, `worker ${endpoint} HTTP status`);
  return (await response.json()) as WorkerHealth;
}

function assertOptIn(): void {
  if (
    process.env.RUN_PHASE0_WORKER_RUNTIME_SMOKE !== 'true' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.SECRETS_ENABLED !== 'true'
  ) {
    throw new Error('Worker runtime smoke requires isolated test/Vault opt-in');
  }
}

function expectRedisUnavailable(): boolean {
  return process.env.EXPECT_REDIS_UNAVAILABLE === 'true';
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Worker runtime smoke assertion failed: ${message}`);
  }
}

void validateWorkerRuntime().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Phase 0 worker runtime smoke failed',
  );
  process.exitCode = 1;
});
