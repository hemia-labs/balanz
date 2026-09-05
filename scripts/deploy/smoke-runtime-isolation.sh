#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $(id -u) -ne 0 || ${BALANZ_DISPOSABLE_CONTAINER:-} != phase0-runtime-isolation-v1 ||
      ! -f /.dockerenv ]]; then
  echo "runtime isolation smoke is restricted to the designated disposable Docker container" >&2
  exit 77
fi
if [[ ! -x /usr/bin/sudo || -L /usr/bin/sudo ||
      $(stat -c '%U:%G:%a' -- /usr/bin/sudo) != root:root:4755 ||
      -e /usr/local/bin/bun || -L /usr/local/bin/bun ]]; then
  echo "disposable image lacks the expected sudo boundary or unexpectedly contains Bun" >&2
  exit 77
fi
if [[ ! -x /usr/local/bin/node || -L /usr/local/bin/node ||
      $(/usr/local/bin/node -p 'process.versions.node') != 22.22.0 ]]; then
  echo "runtime isolation smoke requires the pinned Node.js 22.22.0 image" >&2
  exit 69
fi
container_hostname=$(hostname)
grep -Eq "(^|[[:space:]])${container_hostname//./\\.}([[:space:]]|$)" /etc/hosts ||
  printf '127.0.0.1 %s\n' "$container_hostname" >>/etc/hosts

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
/usr/local/bin/node -e '
  const assert = require("node:assert/strict");
  const scripts = require(process.argv[1]).scripts;
  assert.match(scripts["release:prepare"], /^bun run /);
  assert.match(scripts["db:prepare"], /^bun run /);
  assert.doesNotMatch(scripts["release:prepare"], /\bnpm\b/);
  assert.doesNotMatch(scripts["db:prepare"], /\bnpm\b/);
' "$repo_root/apps/api/package.json"
smoke_root=$(mktemp -d /tmp/balanz-runtime-isolation.XXXXXX)
deploy_root="$smoke_root/deploy"
release_dir="$deploy_root/releases/test-release"

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  for process_file in /tmp/balanz-api-observed /tmp/balanz-api-signal /tmp/balanz-migrator-observed; do
    rm -f -- "$process_file"
  done
  rm -f -- /tmp/balanz-smoke-sudo-allow-balanz-api
  rm -f -- /usr/local/bin/bun /etc/sudoers.d/balanz-runtime-smoke
  if [[ -d $smoke_root && $(basename -- "$smoke_root") == balanz-runtime-isolation.* ]]; then
    rm -rf -- "$smoke_root" || status=1
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for identity in balanz-deploy balanz-web balanz-api balanz-worker balanz-migrator; do
  getent passwd "$identity" >/dev/null && {
    echo "disposable runtime identity already exists: $identity" >&2
    exit 77
  }
done
for group in balanz-runtime balanz-api-config balanz-worker-config balanz-migrator-config; do
  getent group "$group" >/dev/null && {
    echo "disposable runtime group already exists: $group" >&2
    exit 77
  }
  groupadd --system "$group"
done

useradd --system --user-group --create-home --home-dir "$smoke_root/home-balanz-deploy" \
  --shell /bin/bash balanz-deploy
for identity in balanz-web balanz-api balanz-worker balanz-migrator; do
  useradd --system --user-group --create-home --home-dir "$smoke_root/home-$identity" \
    --shell /usr/sbin/nologin "$identity"
  usermod --append --groups balanz-runtime "$identity"
done
usermod --append --groups balanz-api-config balanz-api
usermod --append --groups balanz-worker-config balanz-worker
usermod --append --groups balanz-migrator-config balanz-migrator
usermod --append --groups \
  balanz-runtime,balanz-api-config,balanz-worker-config,balanz-migrator-config \
  balanz-deploy
cat >/etc/sudoers.d/balanz-runtime-smoke <<'SUDOERS'
balanz-deploy ALL=(balanz-web) NOPASSWD: ALL
balanz-deploy ALL=(balanz-api) NOPASSWD: ALL
balanz-deploy ALL=(balanz-worker) NOPASSWD: ALL
balanz-deploy ALL=(balanz-migrator) NOPASSWD: ALL
SUDOERS
chmod 0440 /etc/sudoers.d/balanz-runtime-smoke
visudo -cf /etc/sudoers.d/balanz-runtime-smoke >/dev/null
cat >/usr/local/bin/bun <<'FAKE_BUN'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ ${1:-} == --version ]]; then
  printf '%s\n' 1.3.2
  exit 0
fi
[[ ${1:-} == --env-file=* && ${2:-} == run && ${3:-} == release:prepare ]]
config=${1#--env-file=}
grep -Fqx 'MIGRATOR_ONLY=isolated-migrator' "$config"
[[ $(id -un) == balanz-migrator ]]
[[ -x node_modules/.bin/ts-node ]]
node_modules/.bin/ts-node
printf '%s\n' "$(id -un):PASS" >/tmp/balanz-migrator-observed
FAKE_BUN
chmod 0755 /usr/local/bin/bun

install -d -m 0700 \
  "$release_dir/apps/api/dist" \
  "$release_dir/apps/api/node_modules/.bin" \
  "$release_dir/apps/web/node_modules/next/dist/bin" \
  "$release_dir/scripts/deploy" \
  "$deploy_root/.pm2"
cp -- \
  "$repo_root/scripts/deploy/run-isolated-runtime.sh" \
  "$repo_root/scripts/deploy/quiesce-legacy-release.sh" \
  "$repo_root/scripts/deploy/preflight-release-topology.sh" \
  "$repo_root/scripts/deploy/prepare-runtime-isolation.sh" \
  "$repo_root/scripts/deploy/persist-pm2-state.sh" \
  "$repo_root/scripts/deploy/run-release-migrations.sh" \
  "$repo_root/scripts/deploy/write-secret-file.sh" \
  "$repo_root/scripts/deploy/hash-release-artifact.cjs" \
  "$release_dir/scripts/deploy/"
cp -- "$repo_root/ecosystem.config.cjs" "$release_dir/ecosystem.config.cjs"
printf '%s\n' '{"scripts":{"release:prepare":"unused-by-fake-bun"}}' > \
  "$release_dir/apps/api/package.json"
cat >"$release_dir/apps/api/dist/main.js" <<'API_FIXTURE'
const fs = require('node:fs');
fs.writeFileSync('/tmp/balanz-api-observed', JSON.stringify({
  uid: process.getuid(),
  api: process.env.API_ONLY,
  worker: process.env.WORKER_ONLY,
  inherited: process.env.INHERITED_CANARY,
}));
process.on('SIGTERM', () => {
  fs.writeFileSync('/tmp/balanz-api-signal', 'SIGTERM');
  process.exit(0);
});
setInterval(() => undefined, 1000);
API_FIXTURE
printf '%s\n' 'setInterval(() => undefined, 1000);' > \
  "$release_dir/apps/api/dist/worker.js"
printf '%s\n' 'setInterval(() => undefined, 1000);' > \
  "$release_dir/apps/web/node_modules/next/dist/bin/next"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > \
  "$release_dir/apps/api/node_modules/.bin/ts-node"
chmod 0755 "$release_dir/apps/api/node_modules/.bin/ts-node"

chown balanz-deploy:balanz-runtime "$smoke_root"
chown -R --no-dereference balanz-deploy:balanz-deploy "$deploy_root"
chmod 0750 "$smoke_root" "$deploy_root" "$deploy_root/releases" "$release_dir"
chmod 0700 "$deploy_root/.pm2"

as_deploy() {
  /usr/bin/sudo -n -u balanz-deploy -- \
    /usr/bin/env -i \
    "HOME=$smoke_root/home-balanz-deploy" \
    'PATH=/usr/local/bin:/usr/bin:/bin' \
    "$@"
}

as_deploy bash "$release_dir/scripts/deploy/preflight-release-topology.sh" \
  "$release_dir" "$deploy_root"

groupadd --system balanz-rogue
usermod --append --groups balanz-rogue balanz-api
if as_deploy bash "$release_dir/scripts/deploy/preflight-release-topology.sh" \
  "$release_dir" "$deploy_root" >/dev/null 2>&1; then
  echo "preflight accepted an unexpected API group" >&2
  exit 1
fi
gpasswd --delete balanz-api balanz-rogue >/dev/null

printf '%s\n' 'balanz-api ALL=(root) NOPASSWD: /bin/true' >> \
  /etc/sudoers.d/balanz-runtime-smoke
visudo -cf /etc/sudoers.d/balanz-runtime-smoke >/dev/null
if as_deploy bash "$release_dir/scripts/deploy/preflight-release-topology.sh" \
  "$release_dir" "$deploy_root" >/dev/null 2>&1; then
  echo "preflight accepted runtime sudo authority" >&2
  exit 1
fi
sed -i '$d' /etc/sudoers.d/balanz-runtime-smoke
visudo -cf /etc/sudoers.d/balanz-runtime-smoke >/dev/null

printf '%s\n' 'runtime-controlled-outside-target' >"$smoke_root/outside-target"
chown balanz-api:balanz-api "$smoke_root/outside-target"
as_deploy ln -s "$smoke_root/outside-target" "$release_dir/apps/api/absolute-escape"
if as_deploy bash "$release_dir/scripts/deploy/prepare-runtime-isolation.sh" \
  "$release_dir" "$deploy_root" >/dev/null 2>&1; then
  echo "prepare accepted an external absolute symbolic link" >&2
  exit 1
fi
as_deploy rm -f "$release_dir/apps/api/absolute-escape"

ln -s "$release_dir/apps/api/dist/main.js" "$smoke_root/reentry-bridge"
as_deploy ln -s ../../../../../reentry-bridge "$release_dir/apps/api/escape-reentry"
if as_deploy bash "$release_dir/scripts/deploy/prepare-runtime-isolation.sh" \
  "$release_dir" "$deploy_root" >/dev/null 2>&1; then
  echo "prepare accepted a symbolic-link escape and external re-entry" >&2
  exit 1
fi
as_deploy rm -f "$release_dir/apps/api/escape-reentry"
rm -f "$smoke_root/reentry-bridge"

as_deploy bash "$release_dir/scripts/deploy/prepare-runtime-isolation.sh" \
  "$release_dir" "$deploy_root"
printf '%s\n' 'API_ONLY=isolated-api' | \
  as_deploy bash "$release_dir/scripts/deploy/write-secret-file.sh" \
    "$release_dir" "$deploy_root" api
printf '%s\n' 'WORKER_ONLY=isolated-worker' | \
  as_deploy bash "$release_dir/scripts/deploy/write-secret-file.sh" \
    "$release_dir" "$deploy_root" worker

as_deploy bash "$release_dir/scripts/deploy/run-isolated-runtime.sh" api --check >/dev/null
as_deploy bash "$release_dir/scripts/deploy/run-isolated-runtime.sh" worker --check >/dev/null

export INHERITED_CANARY=must-not-cross-runtime-boundary
/usr/bin/sudo -n -u balanz-deploy -- \
  /usr/bin/env -i \
  "HOME=$smoke_root/home-balanz-deploy" \
  'PATH=/usr/local/bin:/usr/bin:/bin' \
  'INHERITED_CANARY=must-not-cross-runtime-boundary' \
  bash "$release_dir/scripts/deploy/run-isolated-runtime.sh" api &
api_wrapper_pid=$!
for _ in $(seq 1 100); do
  [[ -f /tmp/balanz-api-observed ]] && break
  sleep 0.05
done
[[ -f /tmp/balanz-api-observed ]]
expected_api_uid=$(id -u balanz-api)
node -e '
  const value = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (value.uid !== Number(process.argv[2]) || value.api !== "isolated-api" || value.worker || value.inherited) process.exit(1);
' /tmp/balanz-api-observed "$expected_api_uid"
kill -TERM "$api_wrapper_pid"
wait "$api_wrapper_pid"
[[ $(cat /tmp/balanz-api-signal) == SIGTERM ]]

for forbidden_env in .env.api.local .env.api .env.worker.local .env.worker .env.local .env; do
  as_deploy touch "$release_dir/apps/api/$forbidden_env"
  if printf '%s\n' 'MIGRATOR_ONLY=must-not-run' | \
    as_deploy bash "$release_dir/scripts/deploy/run-release-migrations.sh" \
      "$release_dir" "$deploy_root" >/dev/null 2>&1; then
    echo "migration accepted forbidden runtime environment file $forbidden_env" >&2
    exit 1
  fi
  as_deploy rm -f "$release_dir/apps/api/$forbidden_env"
done

printf '%s\n' 'MIGRATOR_ONLY=isolated-migrator' | \
  as_deploy bash "$release_dir/scripts/deploy/run-release-migrations.sh" \
    "$release_dir" "$deploy_root"
[[ $(cat /tmp/balanz-migrator-observed) == balanz-migrator:PASS ]]
[[ ! -e $deploy_root/runtime-config/test-release/migrator/runtime.env ]]

printf '%s\n' 'runtime isolation smoke passed: UIDs, groups, sudo, config ACL, env isolation, migrator and SIGTERM'
