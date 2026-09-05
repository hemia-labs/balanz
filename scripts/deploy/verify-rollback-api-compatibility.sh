#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 || $1 != /* || $2 != /* ]]; then
  echo "usage: verify-rollback-api-compatibility.sh /absolute/release /absolute/deploy-root" >&2
  exit 64
fi

release_dir=$(realpath -e -- "$1")
deploy_root=$(realpath -e -- "$2")
releases_root=$(realpath -e -- "$deploy_root/releases")
current_link="$deploy_root/current"
pm2_home="$deploy_root/.pm2"
marker="$release_dir/.rollback-api-compatible"
legacy_cutover_marker="$release_dir/.legacy-cutover-quiesced"
temporary=''
armed=false
must_stop_on_failure=false

cleanup_marker() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n $temporary && ( -e $temporary || -L $temporary ) ]]; then
    rm -f -- "$temporary" || status=74
  fi
  if [[ $armed != true && ( -e $marker || -L $marker ) ]]; then
    rm -f -- "$marker" || status=74
  fi
  if [[ $status -ne 0 && $must_stop_on_failure == true ]] &&
    ! quiesce_pm2_control_plane_fail_closed "$pm2_home"; then
    status=75
  fi
  exit "$status"
}

trap cleanup_marker EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ $(dirname -- "$release_dir") != "$releases_root" ]]; then
  echo "release must be a direct child of the deployment releases directory" >&2
  exit 72
fi
rm -f -- "$marker"

# A first deployment has no rollback binary to verify. Activation still fails
# closed and removes every managed process if its probes do not pass.
if [[ ! -L $current_link ]]; then
  if [[ -e $current_link ]]; then
    echo "current release path must be a symbolic link" >&2
    exit 72
  fi
  armed=true
  trap - EXIT HUP INT TERM
  exit 0
fi

previous_release=$(readlink -f -- "$current_link")
if [[ ! -d $previous_release || $(dirname -- "$previous_release") != "$releases_root" ]]; then
  echo "current release link has no valid target" >&2
  exit 72
fi

pm2_cli="$release_dir/node_modules/pm2/bin/pm2"
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
if [[ ! -f $pm2_state_helper || -L $pm2_state_helper ]]; then
  echo "durable PM2 state helper is required" >&2
  exit 69
fi
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
for command_name in curl sha256sum; do
  command -v "$command_name" >/dev/null || {
    echo "$command_name is required to verify rollback compatibility" >&2
    exit 69
  }
done
must_stop_on_failure=true

# The only accepted pre-Phase-0 release is deliberately stopped and stripped of
# its deploy-readable credential before any new credential is staged. It cannot
# be restarted safely, so the first cutover has an explicit fail-closed path and
# no automatic legacy rollback.
if [[ -e $legacy_cutover_marker || -L $legacy_cutover_marker ]]; then
  bash "$release_dir/scripts/deploy/quiesce-legacy-release.sh" \
    "$release_dir" "$deploy_root" --check
  armed=true
  trap - EXIT HUP INT TERM
  exit 0
fi

# Stop the complete control plane before trusting or cold-starting rollback
# artifacts. If validation fails, the candidate remains unactivated and both
# durable dumps remain empty.
if ! quiesce_pm2_control_plane_fail_closed "$pm2_home"; then
  echo "previous release could not be quiesced before rollback validation" >&2
  exit 75
fi

validator="$release_dir/scripts/deploy/validate-ecosystem.cjs"
/usr/local/bin/node "$validator" \
  "$previous_release/ecosystem.config.cjs" \
  "$previous_release/apps/api" \
  rollback-api
if [[ ! -f $previous_release/apps/api/dist/main.js ]]; then
  echo "previous API entrypoint is missing" >&2
  exit 72
fi
previous_id=$(basename -- "$previous_release")
previous_api_config="$deploy_root/runtime-config/$previous_id/api/runtime.env"
if [[ ! -f $previous_api_config || -L $previous_api_config ||
      $(stat -c '%U:%G:%a' -- "$previous_api_config") != "$(id -un):balanz-api-config:640" ]]; then
  echo "previous isolated API configuration is missing or unsafe" >&2
  exit 74
fi
pm2_live_processes_are_empty || {
  echo "PM2 control plane was repopulated before rollback validation" >&2
  exit 75
}

# A hard restart proves that the previous API can bootstrap a fresh TypeORM
# connection after the forward-only migrations, rather than merely serving
# from an already-running pre-migration process.
cd "$previous_release"
pm2 startOrRestart ecosystem.config.cjs --only balanz-api-dev --update-env
curl \
  --fail \
  --silent \
  --show-error \
  --retry 10 \
  --retry-connrefused \
  --retry-delay 2 \
  --retry-max-time 45 \
  --connect-timeout 2 \
  --max-time 5 \
  http://127.0.0.1:3021/api/v1 >/dev/null
pm2_live_processes_match "$previous_release" balanz-api-dev || {
  echo "rollback compatibility check started an unexpected process set" >&2
  exit 75
}

artifact_hasher="$release_dir/scripts/deploy/hash-release-artifact.cjs"
previous_artifact_hash=$(/usr/local/bin/node "$artifact_hasher" "$previous_release")
previous_api_config_hash=$(sha256sum -- "$previous_api_config")
previous_api_config_hash=${previous_api_config_hash%% *}

# Restore only the rollback-compatible web/API set. The old worker must never
# resume after forward migrations.
pm2 startOrRestart ecosystem.config.cjs \
  --only "balanz-web-dev,balanz-api-dev" \
  --update-env
pm2_live_processes_match \
  "$previous_release" balanz-api-dev balanz-web-dev
curl \
  --fail \
  --silent \
  --show-error \
  --retry 10 \
  --retry-connrefused \
  --retry-delay 2 \
  --retry-max-time 45 \
  --connect-timeout 2 \
  --max-time 5 \
  http://127.0.0.1:5181/ >/dev/null

persist_pm2_state_durably \
  "$pm2_home" "$previous_release" balanz-api-dev balanz-web-dev
systemctl_control restart balanz-pm2.service
systemctl_control is-active --quiet balanz-pm2.service
pm2_live_processes_match \
  "$previous_release" balanz-api-dev balanz-web-dev
curl \
  --fail \
  --silent \
  --show-error \
  --retry 10 \
  --retry-connrefused \
  --retry-delay 2 \
  --retry-max-time 45 \
  --connect-timeout 2 \
  --max-time 5 \
  http://127.0.0.1:3021/api/v1 >/dev/null
curl \
  --fail \
  --silent \
  --show-error \
  --retry 10 \
  --retry-connrefused \
  --retry-delay 2 \
  --retry-max-time 45 \
  --connect-timeout 2 \
  --max-time 5 \
  http://127.0.0.1:5181/ >/dev/null

umask 077
temporary=$(mktemp -- "$release_dir/.rollback-api-compatible.XXXXXX")
printf '%s\n%s\n%s\n' \
  "$previous_release" \
  "$previous_artifact_hash" \
  "$previous_api_config_hash" >"$temporary"
chmod 0600 -- "$temporary"
mv -T -- "$temporary" "$marker"
temporary=''
if [[ -L $marker || $(stat -c '%a' -- "$marker") != 600 ]]; then
  echo "rollback compatibility marker was not installed safely" >&2
  exit 74
fi

armed=true
trap - EXIT HUP INT TERM
