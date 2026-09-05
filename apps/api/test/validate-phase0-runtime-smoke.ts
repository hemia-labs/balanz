import { createSecretsClient, type SecretsScope } from '@hemia/secrets';
import { Client } from 'pg';
import { isDatabaseSecret } from '../src/database/types/database.types';

interface RuntimeSmokeInput {
  email: string;
  password: string;
  organizationAId: string;
  membershipAId: string;
  organizationBId: string;
  membershipBId: string;
  objectId: string;
}

interface ApiAclState {
  current_user: string;
  session_user: string;
  can_insert_audit: boolean;
  can_read_roles: boolean;
  can_update_sessions: boolean;
  delete_privilege_count: number;
  sequence_privilege_count: number;
}

const scope: SecretsScope = {
  environment: 'dev',
  category: 'internal',
  owner: 'balanz',
  system: 'api',
};

async function validateRuntimeSmoke(): Promise<void> {
  assertRuntimeOptIn();
  const input = await readInput();
  validateInput(input);
  const baseUrl = 'http://127.0.0.1:3021';
  const origin = 'http://localhost:5181';

  const unauthenticated = await fetch(`${baseUrl}/api/v1/roles`);
  assert(unauthenticated.status === 401, 'session guard denial');

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  assert(login.status === 201, `real login route status=${login.status}`);
  const loginBody = (await login.json()) as Record<string, unknown>;
  assert(loginBody.requiresMfa === false, 'non-MFA synthetic login');
  const setCookie = login.headers.get('set-cookie');
  assert(typeof setCookie === 'string', 'session cookie');
  const cookie = setCookie.split(';', 1)[0];
  assert(cookie.startsWith('balanz_session='), 'expected session cookie name');

  const organizations = await authenticatedFetch(
    `${baseUrl}/api/v1/me/organizations`,
    cookie,
  );
  assert(organizations.status === 200, 'organization route');
  const organizationItems = (await organizations.json()) as Array<{
    id?: unknown;
  }>;
  assert(
    Array.isArray(organizationItems) &&
      organizationItems.some(({ id }) => id === input.organizationAId) &&
      organizationItems.some(({ id }) => id === input.organizationBId),
    'organization scope from API runtime principal',
  );

  const selected = await authenticatedFetch(
    `${baseUrl}/api/v1/auth/session/organization`,
    cookie,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ organizationId: input.organizationAId }),
    },
  );
  assert(selected.status === 200, 'tenant selection route');

  const authorization = await authenticatedFetch(
    `${baseUrl}/api/v1/me/authorization`,
    cookie,
  );
  assert(authorization.status === 200, 'authorization route');
  const authorizationBody = (await authorization.json()) as Record<
    string,
    unknown
  >;
  assert(
    authorizationBody.organizationId === input.organizationAId &&
      authorizationBody.membershipId === input.membershipAId &&
      authorizationBody.role === 'admin' &&
      Array.isArray(authorizationBody.permissions) &&
      authorizationBody.permissions.includes('organization.view'),
    'effective tenant permissions',
  );

  const roles = await authenticatedFetch(`${baseUrl}/api/v1/roles`, cookie);
  assert(roles.status === 200, 'permission-protected route');
  const roleItems = (await roles.json()) as Array<{ key?: unknown }>;
  assert(
    Array.isArray(roleItems) && roleItems.some(({ key }) => key === 'admin'),
    'seeded role catalog through API principal',
  );

  const sensitive = await authenticatedFetch(
    `${baseUrl}/api/v1/permissions`,
    cookie,
  );
  assert(sensitive.status === 403, 'MFA-sensitive permission denial');
  const sensitiveBody = (await sensitive.json()) as Record<string, unknown>;
  assert(sensitiveBody.message === 'MFA_SETUP_REQUIRED', 'denial reason');

  await validateFiscalRls(input);

  const logout = await authenticatedFetch(
    `${baseUrl}/api/v1/auth/session`,
    cookie,
    { method: 'DELETE', headers: { origin } },
  );
  assert(logout.status === 204, 'clean logout route');

  console.log(
    JSON.stringify({
      status: 'PASS',
      entrypoint: 'dist/main.js',
      authentication: 'LOGIN_SESSION_LOGOUT',
      authorization: 'TENANT_AND_PERMISSION_GUARDS',
      fiscalRls: 'API_ROLE_TENANT_A_B_FAIL_CLOSED',
      secretValuesPrinted: false,
    }),
  );
}

async function validateFiscalRls(input: RuntimeSmokeInput): Promise<void> {
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
  const database = await secrets.getRequired('database/postgres-api');
  assert(isDatabaseSecret(database), 'API database secret shape');
  const client = new Client({
    host: database.db_host,
    port: database.db_port,
    database: database.db_database,
    user: database.db_username,
    password: database.db_password,
    options:
      '-c timezone=America/Mexico_City -c search_path=public -c role=balanz_api',
  });
  await client.connect();
  try {
    const acl = await client.query<ApiAclState>(`
      SELECT
        current_user,
        session_user,
        has_table_privilege(current_user, 'public.audit_events', 'INSERT')
          AS can_insert_audit,
        has_table_privilege(current_user, 'public.roles', 'SELECT')
          AS can_read_roles,
        has_table_privilege(current_user, 'public.auth_sessions', 'UPDATE')
          AS can_update_sessions,
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
    `);
    const aclState = acl.rows[0];
    assert(
      aclState?.current_user === 'balanz_api' &&
        aclState.session_user === database.db_username,
      'API LOGIN selects the closed runtime group at connection startup',
    );
    assert(
      aclState.can_insert_audit &&
        aclState.can_read_roles &&
        aclState.can_update_sessions,
      'API inherited operation-specific ACL',
    );
    assert(
      aclState.delete_privilege_count === 0,
      'API has no DELETE privilege',
    );
    assert(
      aclState.sequence_privilege_count === 0,
      'API has no public sequence privilege',
    );

    const noContext = await client.query<{ visible: number }>(
      'SELECT count(*)::integer AS visible FROM public.stored_objects WHERE id = $1',
      [input.objectId],
    );
    assert(noContext.rows[0]?.visible === 0, 'RLS absent context fail-closed');

    await client.query('BEGIN');
    let invalidContextRejected = false;
    try {
      await setTenantContext(client, 'not-a-uuid', input.membershipAId);
      await client.query('SELECT count(*) FROM public.stored_objects');
    } catch (error: unknown) {
      invalidContextRejected =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '22P02';
    } finally {
      await client.query('ROLLBACK');
    }
    assert(invalidContextRejected, 'RLS invalid context fail-closed');

    const tenantA = await visibleObjectCount(
      client,
      input.organizationAId,
      input.membershipAId,
      input.objectId,
    );
    const tenantB = await visibleObjectCount(
      client,
      input.organizationBId,
      input.membershipBId,
      input.objectId,
    );
    assert(tenantA === 1, 'RLS tenant A visibility');
    assert(tenantB === 0, 'RLS tenant B isolation');
  } finally {
    await client.end();
  }
}

async function visibleObjectCount(
  client: Client,
  organizationId: string,
  membershipId: string,
  objectId: string,
): Promise<number> {
  await client.query('BEGIN');
  try {
    await setTenantContext(client, organizationId, membershipId);
    const result = await client.query<{ visible: number }>(
      'SELECT count(*)::integer AS visible FROM public.stored_objects WHERE id = $1',
      [objectId],
    );
    await client.query('COMMIT');
    return result.rows[0]?.visible ?? -1;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function setTenantContext(
  client: Client,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  await client.query(
    `SELECT
       set_config('app.organization_id', $1, true),
       set_config('app.membership_id', $2, true)`,
    [organizationId, membershipId],
  );
}

function authenticatedFetch(
  url: string,
  cookie: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...init.headers, cookie },
  });
}

async function readInput(): Promise<RuntimeSmokeInput> {
  process.stdin.setEncoding('utf8');
  let serialized = '';
  for await (const rawChunk of process.stdin) {
    const chunk: unknown = rawChunk;
    if (typeof chunk !== 'string') throw new Error('Invalid smoke input');
    serialized += chunk;
  }
  return JSON.parse(serialized) as RuntimeSmokeInput;
}

function validateInput(input: RuntimeSmokeInput): void {
  assert(
    typeof input.email === 'string' && input.email.endsWith('@example.test'),
    'synthetic email',
  );
  assert(
    typeof input.password === 'string' && input.password.length >= 16,
    'synthetic password',
  );
  for (const value of [
    input.organizationAId,
    input.membershipAId,
    input.organizationBId,
    input.membershipBId,
    input.objectId,
  ]) {
    assert(
      typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value,
        ),
      'synthetic UUID v4',
    );
  }
}

function assertRuntimeOptIn(): void {
  if (
    process.env.RUN_PHASE0_RUNTIME_SMOKE !== 'true' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.SECRETS_ENABLED !== 'true'
  ) {
    throw new Error('Runtime smoke requires isolated test/Vault opt-in');
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Runtime smoke assertion failed: ${message}`);
}

void validateRuntimeSmoke().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Phase 0 runtime smoke failed',
  );
  process.exitCode = 1;
});
