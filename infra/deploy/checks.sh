#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
export SECRETS_ENABLED=false
export NEXT_PUBLIC_API_URL=https://api-contable.hemia.dev/api/v1
bun install --frozen-lockfile --ignore-scripts
node --test infra/deploy/deploy-release.test.cjs infra/deploy/retain-releases.test.cjs infra/deploy/release.test.mjs
python3 -m unittest discover -s infra/deploy -p 'test_balanz_deploy.py'
bun run --cwd apps/api lint
bun run --cwd apps/api test --runInBand
bun run --cwd apps/api build
bun run --cwd apps/web lint
bun run --cwd apps/web typecheck
bun run --cwd apps/web test
bun run --cwd apps/web build
# Keep migrator DB_* out of API/worker unit-test environments.
(
  export NODE_ENV=test
  export DB_HOST="${CI_DB_HOST:?Disposable CI PostgreSQL host is required}"
  export DB_PORT="${CI_DB_PORT:-5432}"
  export DB_USERNAME="${CI_DB_USERNAME:?Disposable CI PostgreSQL user is required}"
  export DB_PASSWORD="${CI_DB_PASSWORD:?Disposable CI PostgreSQL password is required}"
  export DB_DATABASE="${CI_DB_DATABASE:?Disposable CI PostgreSQL database is required}"
  export PGPASSWORD="$DB_PASSWORD"
  psql -h "$DB_HOST" -U "$DB_USERNAME" -d "$DB_DATABASE" -v ON_ERROR_STOP=1 \
    -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'
  bun run --cwd apps/api qa:migrations
  bun run --cwd apps/api migration:run
  bun run --cwd apps/api qa:migrations
)
bash infra/deploy/check-images.sh
