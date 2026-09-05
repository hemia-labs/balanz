#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 || $1 != /* || $2 != /* ]]; then
  echo "usage: activate-release.sh /absolute/release /absolute/deploy-root" >&2
  exit 64
fi

release_dir=$(realpath -e -- "$1")
deploy_root=$(realpath -e -- "$2")
releases_root=$(realpath -e -- "$deploy_root/releases")
current_link="$deploy_root/current"
next_link="$deploy_root/current.next"
rollback_link="$deploy_root/current.rollback"
pm2_home="$deploy_root/.pm2"
previous_release=''
activated=false
legacy_cutover=false

if [[ $(dirname -- "$release_dir") != "$releases_root" ]]; then
  echo "release must be a direct child of the deployment releases directory" >&2
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
command -v curl >/dev/null || {
  echo "curl is required to validate a release" >&2
  exit 69
}
command -v sha256sum >/dev/null || {
  echo "sha256sum is required to validate rollback evidence" >&2
  exit 69
}

if [[ -L $current_link ]]; then
  previous_release=$(readlink -f -- "$current_link")
  if [[ ! -d $previous_release || $(dirname -- "$previous_release") != "$releases_root" ]]; then
    echo "current release link has no valid target" >&2
    exit 72
  fi
elif [[ -e $current_link ]]; then
  echo "current release path must be a symbolic link" >&2
  exit 72
fi

probe() {
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
    "$1" >/dev/null
}

rollback_evidence_is_valid() {
  local marker="$release_dir/.rollback-api-compatible"
  local marker_release marker_artifact_hash marker_api_config_hash
  local actual_artifact_hash actual_api_config_hash previous_id previous_api_config
  local -a marker_lines=()

  [[ -n $previous_release ]] || return 1
  [[ -f $marker && ! -L $marker && $(stat -c '%a' -- "$marker") == 600 ]] || return 1
  mapfile -t marker_lines <"$marker"
  [[ ${#marker_lines[@]} -eq 3 ]] || return 1
  marker_release=${marker_lines[0]}
  marker_artifact_hash=${marker_lines[1]}
  marker_api_config_hash=${marker_lines[2]}
  [[ $marker_release == "$previous_release" ]] || return 1
  [[ $marker_artifact_hash =~ ^[[:xdigit:]]{64}$ ]] || return 1
  [[ $marker_api_config_hash =~ ^[[:xdigit:]]{64}$ ]] || return 1
  [[ -f $previous_release/ecosystem.config.cjs ]] || return 1
  [[ -f $previous_release/apps/api/dist/main.js ]] || return 1
  previous_id=$(basename -- "$previous_release")
  previous_api_config="$deploy_root/runtime-config/$previous_id/api/runtime.env"
  [[ -f $previous_api_config && ! -L $previous_api_config ]] || return 1
  [[ $(stat -c '%U:%G:%a' -- "$previous_api_config") == "$(id -un):balanz-api-config:640" ]] || return 1
  actual_artifact_hash=$(/usr/local/bin/node \
    "$release_dir/scripts/deploy/hash-release-artifact.cjs" \
    "$previous_release") || return 1
  actual_api_config_hash=$(sha256sum -- "$previous_api_config")
  actual_api_config_hash=${actual_api_config_hash%% *}
  [[ $actual_artifact_hash == "$marker_artifact_hash" ]] || return 1
  [[ $actual_api_config_hash == "$marker_api_config_hash" ]] || return 1
  /usr/local/bin/node "$release_dir/scripts/deploy/validate-ecosystem.cjs" \
    "$previous_release/ecosystem.config.cjs" \
    "$previous_release/apps/api" \
    rollback-api
}

restart_previous_release() {
  if [[ -n $previous_release ]]; then
    if ! quiesce_pm2_control_plane_fail_closed "$pm2_home"; then
      return 1
    fi
    if ! rollback_evidence_is_valid; then
      echo "rollback evidence is unavailable or changed; managed processes remain stopped" >&2
      return 1
    fi
    if ! ln -sfn -- "$previous_release" "$rollback_link" ||
       ! mv -Tf -- "$rollback_link" "$current_link"; then
      quiesce_pm2_control_plane_fail_closed "$pm2_home" || true
      return 1
    fi
    if ! cd "$previous_release"; then
      quiesce_pm2_control_plane_fail_closed "$pm2_home" || true
      return 1
    fi
    if ! pm2 startOrRestart ecosystem.config.cjs \
      --only "balanz-web-dev,balanz-api-dev" \
      --update-env; then
      quiesce_pm2_control_plane_fail_closed "$pm2_home" || true
      return 1
    fi
    if ! pm2_live_processes_match \
      "$previous_release" balanz-api-dev balanz-web-dev; then
      echo "rollback started an unexpected or path-invalid process set" >&2
      quiesce_pm2_control_plane_fail_closed "$pm2_home" || true
      return 1
    fi
    if ! probe http://127.0.0.1:5181/ ||
      ! probe http://127.0.0.1:3021/api/v1; then
      quiesce_pm2_control_plane_fail_closed "$pm2_home" || true
      return 1
    fi
    if ! persist_pm2_state_durably \
      "$pm2_home" "$previous_release" balanz-api-dev balanz-web-dev ||
       ! systemctl_control restart balanz-pm2.service ||
       ! systemctl_control is-active --quiet balanz-pm2.service; then
      quiesce_pm2_control_plane_fail_closed "$pm2_home" || true
      return 1
    fi
    if ! pm2_live_processes_match \
      "$previous_release" balanz-api-dev balanz-web-dev ||
       ! probe http://127.0.0.1:5181/ ||
       ! probe http://127.0.0.1:3021/api/v1; then
      echo "rollback failed post-restart validation" >&2
      quiesce_pm2_control_plane_fail_closed "$pm2_home" || true
      return 1
    fi
    return 0
  fi

  quiesce_pm2_control_plane_fail_closed "$pm2_home" || return 1
  rm -f -- "$current_link" || return 1
}

rollback_on_failure() {
  local status=$?
  trap - EXIT HUP INT TERM

  if [[ $status -ne 0 && $activated == true ]]; then
    if [[ $legacy_cutover == true ]]; then
      echo "initial isolated cutover failed; all managed processes will remain stopped" >&2
      if ! quiesce_pm2_control_plane_fail_closed "$pm2_home"; then
        echo "fail-closed process cleanup failed" >&2
        exit 75
      fi
    else
      echo "release health validation failed; restoring the previous release" >&2
      if ! restart_previous_release; then
        echo "automatic rollback failed" >&2
        exit 75
      fi
    fi
  fi

  rm -f -- "$next_link" "$rollback_link"
  exit "$status"
}

trap rollback_on_failure EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -f $release_dir/ecosystem.config.cjs ]]; then
  echo "release does not contain the PM2 configuration" >&2
  exit 72
fi
if [[ ! -f $release_dir/apps/api/dist/main.js || ! -f $release_dir/apps/api/dist/worker.js ]]; then
  echo "release does not contain the API and worker entrypoints" >&2
  exit 72
fi
/usr/local/bin/node "$release_dir/scripts/deploy/validate-ecosystem.cjs" \
  "$release_dir/ecosystem.config.cjs" \
  "$release_dir/apps/api" \
  current
if find -P "$release_dir/apps/api" -mindepth 1 -maxdepth 1 -name '.env*' \
  -print -quit | grep -q .; then
  echo "runtime or migration environment files must not exist inside a release" >&2
  exit 74
fi
for profile in web api worker; do
  bash "$release_dir/scripts/deploy/run-isolated-runtime.sh" "$profile" --check >/dev/null
done

if [[ -e $release_dir/.legacy-cutover-quiesced ||
      -L $release_dir/.legacy-cutover-quiesced ]]; then
  bash "$release_dir/scripts/deploy/quiesce-legacy-release.sh" \
    "$release_dir" "$deploy_root" --check
  legacy_cutover=true
fi

if [[ -n $previous_release && $legacy_cutover != true ]] && ! rollback_evidence_is_valid; then
  echo "rollback API compatibility was not proven for this release" >&2
  exit 75
fi

rm -f -- "$next_link" "$rollback_link"
ln -s -- "$release_dir" "$next_link"
activated=true
mv -Tf -- "$next_link" "$current_link"

cd "$current_link"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2_live_processes_match \
  "$release_dir" balanz-api-dev balanz-web-dev balanz-worker-dev

probe http://127.0.0.1:5181/
probe http://127.0.0.1:3021/liveness
probe http://127.0.0.1:3021/readiness
probe http://127.0.0.1:3002/liveness
probe http://127.0.0.1:3002/readiness

persist_pm2_state_durably \
  "$pm2_home" "$release_dir" balanz-api-dev balanz-web-dev balanz-worker-dev
systemctl_control restart balanz-pm2.service
systemctl_control is-active --quiet balanz-pm2.service
pm2_live_processes_match \
  "$release_dir" balanz-api-dev balanz-web-dev balanz-worker-dev

probe http://127.0.0.1:5181/
probe http://127.0.0.1:3021/liveness
probe http://127.0.0.1:3021/readiness
probe http://127.0.0.1:3002/liveness
probe http://127.0.0.1:3002/readiness
activated=false
trap - EXIT HUP INT TERM
