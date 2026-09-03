#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 || $1 != /* || $2 != /* ]]; then
  echo "usage: pause-managed-worker.sh /absolute/release /absolute/deploy-root" >&2
  exit 64
fi

release_dir=$(realpath -e -- "$1")
deploy_root=$(realpath -e -- "$2")
releases_root=$(realpath -e -- "$deploy_root/releases")
pm2_home="$deploy_root/.pm2"
pm2_cli="$release_dir/node_modules/pm2/bin/pm2"
if [[ $(dirname -- "$release_dir") != "$releases_root" ]]; then
  echo "release must be a direct child of the deployment releases directory" >&2
  exit 69
fi
if [[ ${BALANZ_DISPOSABLE_CONTAINER:-} == phase0-runtime-isolation-v1 &&
      -f /.dockerenv && -x ${BALANZ_DEPLOY_SMOKE_PM2:-} ]]; then
  pm2() { "$BALANZ_DEPLOY_SMOKE_PM2" "$@"; }
else
  if [[ ! -f $pm2_cli || -L $pm2_cli || ! -x /usr/local/bin/node ||
        -L /usr/local/bin/node ]]; then
    echo "the release-local PM2 control plane and system Node.js are required" >&2
    exit 69
  fi
  pm2() { PM2_HOME="$deploy_root/.pm2" /usr/local/bin/node "$pm2_cli" "$@"; }
fi
pm2_state_helper="$release_dir/scripts/deploy/persist-pm2-state.sh"
[[ -f $pm2_state_helper && ! -L $pm2_state_helper ]] || exit 69
# The runtime-verified absolute helper path is linted as a separate input.
# shellcheck disable=SC1090,SC1091
source "$pm2_state_helper"
if ! _pm2_home_is_safe "$pm2_home"; then
  echo "PM2 control directory is missing or unsafe" >&2
  exit 74
fi

systemctl_control() {
  if [[ ${BALANZ_DISPOSABLE_CONTAINER:-} == phase0-runtime-isolation-v1 &&
        -f /.dockerenv && -x ${BALANZ_DEPLOY_SMOKE_SYSTEMCTL:-} ]]; then
    "$BALANZ_DEPLOY_SMOKE_SYSTEMCTL" "$@"
  else
    /usr/bin/sudo -n /usr/bin/systemctl "$@"
  fi
}

fail_closed() {
  local message=$1
  echo "$message" >&2
  if ! quiesce_pm2_control_plane_fail_closed "$pm2_home"; then
    echo "fail-closed PM2 cleanup could not be proven" >&2
  fi
  exit 75
}

current_link="$deploy_root/current"
if [[ -L $current_link ]]; then
  active_release=$(readlink -f -- "$current_link")
  if [[ ! -d $active_release || -L $active_release ||
        $(dirname -- "$active_release") != "$releases_root" ]]; then
    fail_closed "current release link has no valid target"
  fi
elif [[ -e $current_link ]]; then
  fail_closed "current release path must be absent or a symbolic link"
else
  active_release=$release_dir
fi

if pm2 describe balanz-worker-dev >/dev/null 2>&1; then
  if ! pm2 delete balanz-worker-dev; then
    fail_closed "managed worker deletion failed before migration"
  fi
fi
if pm2 describe balanz-worker-dev >/dev/null 2>&1; then
  fail_closed "managed worker could not be removed before migration"
fi

# Persist the absence of the worker so a host restart cannot resume claims
# while the database function contract is changing.
expected_processes=()
for process_name in balanz-web-dev balanz-api-dev; do
  if pm2 describe "$process_name" >/dev/null 2>&1; then
    expected_processes+=("$process_name")
  fi
done
if ! persist_pm2_state_durably \
  "$pm2_home" "$active_release" "${expected_processes[@]}"; then
  fail_closed "managed worker absence could not be persisted safely"
fi
