#!/usr/bin/env bash
set -euo pipefail
BALANZ_PAYMENTS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BALANZ_PAYMENTS_ROOT"
container="balanz-payment-snapshots-test-$$"
trap 'docker stop "$container" >/dev/null 2>&1 || true' EXIT
docker run --detach --rm --name "$container" --publish 127.0.0.1::5432 --env POSTGRES_PASSWORD=isolated-test-only --env POSTGRES_DB=balanz_payments_snapshot_test postgres:18.4 >/dev/null
for attempt in {1..60}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d balanz_payments_snapshot_test >/dev/null 2>&1; then break; fi
  sleep 1
done
TEST_DATABASE_PORT="$(docker port "$container" 5432 | awk -F: '{print $NF}')" TS_NODE_FILES=true TS_NODE_TRANSPILE_ONLY=false node -r ts-node/register "$BALANZ_PAYMENTS_ROOT/test/payments-snapshots.integration.cjs"
