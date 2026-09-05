#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $(id -u) -ne 0 || ${BALANZ_DISPOSABLE_CONTAINER:-} != phase0-runtime-isolation-v1 ||
      ! -f /.dockerenv ]]; then
  echo "PM2 persistence smoke is restricted to the designated disposable Docker container" >&2
  exit 77
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
pm2_cli="$repo_root/node_modules/pm2/bin/pm2"
[[ -f $pm2_cli && ! -L $pm2_cli && -x /usr/local/bin/node &&
    ! -L /usr/local/bin/node ]] || {
  echo "release-pinned PM2 and system Node.js are required" >&2
  exit 69
}
pm2_version=$(/usr/local/bin/node -e \
  'process.stdout.write(require(process.argv[1]).version)' \
  "$repo_root/node_modules/pm2/package.json")
[[ $pm2_version == 7.0.4 ]] || {
  echo "PM2 persistence smoke requires the pinned 7.0.4 implementation" >&2
  exit 69
}

smoke_root=$(mktemp -d /tmp/balanz-pm2-persistence.XXXXXX)
release_dir="$smoke_root/release"
pm2_home="$smoke_root/pm2"
mkdir -m 0700 -- "$release_dir" "$pm2_home"
mkdir -m 0700 -- "$release_dir/scripts" "$release_dir/scripts/deploy"
cp -- "$repo_root/ecosystem.config.cjs" "$release_dir/ecosystem.config.cjs"
cat >"$release_dir/scripts/deploy/run-isolated-runtime.sh" <<'PROCESS_FIXTURE'
#!/usr/bin/env bash
set -Eeuo pipefail
trap 'exit 0' TERM INT
while :; do
  sleep 1
done
PROCESS_FIXTURE
chmod 0700 -- "$release_dir/scripts/deploy/run-isolated-runtime.sh"

pm2() {
  PM2_HOME="$pm2_home" /usr/local/bin/node "$pm2_cli" "$@"
}
# The shutdown helper is not exercised here; the persistence helpers only need
# this symbol to be defined when the shared file is sourced.
systemctl_control() { return 64; }
# The runtime-verified absolute helper path is linted as a separate input.
# shellcheck disable=SC1090,SC1091
source "$repo_root/scripts/deploy/persist-pm2-state.sh"

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  pm2 kill >/dev/null 2>&1 || status=1
  if [[ -d $smoke_root && $(basename -- "$smoke_root") == balanz-pm2-persistence.* ]]; then
    rm -rf -- "$smoke_root" || status=1
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$release_dir"
pm2 startOrReload ecosystem.config.cjs --update-env >/dev/null
pm2_live_processes_match \
  "$release_dir" balanz-api-dev balanz-web-dev balanz-worker-dev
persist_pm2_state_durably \
  "$pm2_home" "$release_dir" balanz-api-dev balanz-web-dev balanz-worker-dev
persist_pm2_dumps_match \
  "$pm2_home" "$release_dir" balanz-api-dev balanz-web-dev balanz-worker-dev

# PM2 7.0.4 logs its backup failure but exits successfully. Keep this
# reproduction version-pinned so an upgrade must intentionally update the
# workaround and test.
rm -f -- "$pm2_home/dump.pm2.bak"
mkdir -m 0700 -- "$pm2_home/dump.pm2.bak"
raw_save_status=0
pm2 save --force >/dev/null 2>&1 || raw_save_status=$?
[[ $raw_save_status -eq 0 && -d $pm2_home/dump.pm2.bak ]] || {
  echo "PM2 7.0.4 backup failure reproduction changed unexpectedly" >&2
  exit 1
}
if persist_pm2_state_durably \
  "$pm2_home" "$release_dir" balanz-api-dev balanz-web-dev balanz-worker-dev \
  >/dev/null 2>&1; then
  echo "durable persistence accepted an unsafe backup target" >&2
  exit 1
fi
rmdir -- "$pm2_home/dump.pm2.bak"
persist_pm2_state_durably \
  "$pm2_home" "$release_dir" balanz-api-dev balanz-web-dev balanz-worker-dev

# A homonymous process with an off-release entrypoint must not be accepted as
# the expected API merely because its PM2 name matches.
pm2 delete balanz-api-dev >/dev/null
cp -- "$release_dir/scripts/deploy/run-isolated-runtime.sh" "$release_dir/rogue-api.sh"
chmod 0700 -- "$release_dir/rogue-api.sh"
pm2 start "$release_dir/rogue-api.sh" \
  --name balanz-api-dev \
  --interpreter /bin/bash \
  -- api >/dev/null
if persist_pm2_state_durably \
  "$pm2_home" "$release_dir" balanz-api-dev balanz-web-dev balanz-worker-dev \
  >/dev/null 2>&1; then
  echo "durable persistence accepted a homonymous off-release PM2 entrypoint" >&2
  exit 1
fi

pm2 delete all >/dev/null
pm2 startOrReload ecosystem.config.cjs --update-env >/dev/null
persist_pm2_state_durably \
  "$pm2_home" "$release_dir" balanz-api-dev balanz-web-dev balanz-worker-dev

printf '%s\n' \
  'real PM2 7.0.4 persistence smoke passed: backup failure and homonymous path rejection'
