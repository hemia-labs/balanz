#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 2 || $# -gt 3 || $1 != /* || $2 != /* ||
      ( $# -eq 3 && $3 != --check ) ]]; then
  echo "usage: quiesce-legacy-release.sh /absolute/release /absolute/deploy-root [--check]" >&2
  exit 64
fi

release_dir=$(realpath -e -- "$1")
deploy_root=$(realpath -e -- "$2")
releases_root=$(realpath -e -- "$deploy_root/releases")
current_link="$deploy_root/current"
required_marker="$release_dir/.legacy-cutover-required"
quiesced_marker="$release_dir/.legacy-cutover-quiesced"
check_only=${3:-}
deploy_user=$(id -un)
legacy_deploy_user=deploy
legacy_deploy_uid=$(id -u "$legacy_deploy_user")
legacy_bootstrap_marker="$deploy_root/.runtime-isolation-bootstrap-v1"
legacy_release_id=e3d4f432dca1df6bbd0877d86e60bd52d8c15325
legacy_ecosystem_sha256=5cfc0f281b9bed7c8d98f3f930cb83b6ef24b4640f88dff961b91023a807b2f9
temporary=''

fail() {
  echo "$1" >&2
  exit "${2:-75}"
}

cleanup_temporary() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n $temporary && ( -e $temporary || -L $temporary ) ]]; then
    rm -f -- "$temporary" || status=74
  fi
  exit "$status"
}

trap cleanup_temporary EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[[ $(dirname -- "$release_dir") == "$releases_root" ]] ||
  fail 'release must be a direct child of the deployment releases directory' 72
[[ $deploy_user == balanz-deploy && $(id -u) != "$legacy_deploy_uid" ]] ||
  fail 'legacy cutover must run from the dedicated deployment identity' 77
[[ -f $legacy_bootstrap_marker && ! -L $legacy_bootstrap_marker &&
    $(stat -c '%U:%G:%a' -- "$legacy_bootstrap_marker") == 'root:balanz-runtime:440' ]] ||
  fail 'root-owned legacy isolation bootstrap evidence is absent' 77

if [[ -z $check_only && ! -e $required_marker && ! -L $required_marker ]]; then
  [[ ! -e $quiesced_marker && ! -L $quiesced_marker ]] ||
    fail 'legacy cutover state is inconsistent' 72
  trap - EXIT HUP INT TERM
  exit 0
fi

marker=$required_marker
expected_modes='600'
if [[ $check_only == --check ]]; then
  marker=$quiesced_marker
  expected_modes='600 640'
fi

[[ -f $marker && ! -L $marker && $(stat -c '%U' -- "$marker") == "$deploy_user" ]] ||
  fail 'legacy cutover marker is missing or unsafe' 72
marker_mode=$(stat -c '%a' -- "$marker")
case " $expected_modes " in
  *" $marker_mode "*) ;;
  *) fail 'legacy cutover marker has an unsafe mode' 72 ;;
esac

mapfile -t marker_lines <"$marker"
[[ ${#marker_lines[@]} -eq 4 && ${marker_lines[0]} == LEGACY_CUTOVER_V1 &&
    ${marker_lines[2]} == "$legacy_release_id" &&
    ${marker_lines[3]} == "$legacy_ecosystem_sha256" ]] ||
  fail 'legacy cutover marker content is invalid' 72
previous_release=${marker_lines[1]}
current_release=''
[[ -L $current_link ]] && current_release=$(readlink -f -- "$current_link")
[[ ( $current_release == "$previous_release" ||
      ( $check_only == --check && $current_release == "$release_dir" ) ) &&
    -d $previous_release && $(dirname -- "$previous_release") == "$releases_root" &&
    $(basename -- "$previous_release") == "$legacy_release_id" ]] ||
  fail 'legacy cutover no longer targets the allowlisted current release' 72
legacy_ecosystem="$previous_release/ecosystem.config.cjs"
[[ -f $legacy_ecosystem && ! -L $legacy_ecosystem ]] ||
  fail 'allowlisted legacy ecosystem is missing or unsafe' 72
actual_legacy_hash=$(sha256sum -- "$legacy_ecosystem")
actual_legacy_hash=${actual_legacy_hash%% *}
[[ $actual_legacy_hash == "$legacy_ecosystem_sha256" ]] ||
  fail 'allowlisted legacy ecosystem changed after preflight' 72

pm2_cli="$release_dir/node_modules/pm2/bin/pm2"
if [[ ${BALANZ_DISPOSABLE_CONTAINER:-} == phase0-runtime-isolation-v1 &&
      -f /.dockerenv && -x ${BALANZ_DEPLOY_SMOKE_PM2:-} ]]; then
  pm2() { "$BALANZ_DEPLOY_SMOKE_PM2" "$@"; }
else
  [[ -f $pm2_cli && ! -L $pm2_cli && -x /usr/local/bin/node &&
      ! -L /usr/local/bin/node ]] ||
    fail 'the release-local PM2 control plane and system Node.js are required' 69
  pm2() { PM2_HOME="$deploy_root/.pm2" /usr/local/bin/node "$pm2_cli" "$@"; }
fi
pm2_state_helper="$release_dir/scripts/deploy/persist-pm2-state.sh"
if [[ ! -f $pm2_state_helper || -L $pm2_state_helper ]]; then
  fail 'durable PM2 state helper is required' 69
fi
# The runtime-verified absolute helper path is linted as a separate input.
# shellcheck disable=SC1090,SC1091
source "$pm2_state_helper"
_pm2_home_is_safe "$deploy_root/.pm2" ||
  fail 'PM2 control directory is missing or unsafe' 74
systemctl_control() {
  if [[ ${BALANZ_DISPOSABLE_CONTAINER:-} == phase0-runtime-isolation-v1 &&
        -f /.dockerenv && -x ${BALANZ_DEPLOY_SMOKE_SYSTEMCTL:-} ]]; then
    "$BALANZ_DEPLOY_SMOKE_SYSTEMCTL" "$@"
  else
    /usr/bin/sudo -n /usr/bin/systemctl "$@"
  fi
}
for command_name in sha256sum ss; do
  command -v "$command_name" >/dev/null ||
    fail "$command_name is required to quiesce the legacy release" 69
done

legacy_processes_are_absent() {
  local process_path process_uid process_cwd
  for process_path in /proc/[0-9]*; do
    process_uid=$(stat -c '%u' -- "$process_path" 2>/dev/null) || continue
    [[ $process_uid == "$legacy_deploy_uid" ]] || continue
    process_cwd=$(readlink -f -- "$process_path/cwd" 2>/dev/null) || continue
    case "$process_cwd" in
      "$previous_release"|"$previous_release"/*) return 1 ;;
    esac
  done
}

legacy_ports_are_absent() {
  local port
  for port in 5181 3021 3002; do
    if ss -H -ltn "sport = :$port" | grep -q .; then
      return 1
    fi
  done
}

legacy_env_link="$previous_release/apps/api/.env"
shared_env="$deploy_root/shared/api.env"

if [[ $check_only != --check ]]; then
  [[ ! -e $legacy_env_link && ! -L $legacy_env_link &&
      ! -e $shared_env && ! -L $shared_env ]] ||
    fail 'root bootstrap did not purge the legacy runtime credential' 74

  quiesce_pm2_control_plane_fail_closed "$deploy_root/.pm2" ||
    fail 'could not quiesce and persist the isolated PM2 control plane'

  for _ in $(seq 1 50); do
    if legacy_processes_are_absent && legacy_ports_are_absent; then
      break
    fi
    sleep 0.1
  done
  legacy_processes_are_absent || fail 'a deploy-owned legacy process remains alive'
  legacy_ports_are_absent || fail 'a legacy application port remains bound'

  umask 077
  temporary=$(mktemp -- "$release_dir/.legacy-cutover-quiesced.XXXXXX")
  printf '%s\n' "${marker_lines[@]}" >"$temporary"
  chmod 0600 -- "$temporary"
  mv -T -- "$temporary" "$quiesced_marker"
  temporary=''
  rm -f -- "$required_marker"
else
  quiesce_pm2_control_plane_fail_closed "$deploy_root/.pm2" ||
    fail 'isolated PM2 control plane is not safely quiesced'
fi

legacy_processes_are_absent || fail 'a deploy-owned legacy process is still alive'
legacy_ports_are_absent || fail 'a legacy application port is still bound'
[[ ! -e $legacy_env_link && ! -L $legacy_env_link &&
    ! -e $shared_env && ! -L $shared_env ]] ||
  fail 'legacy runtime credentials remain accessible' 74

trap - EXIT HUP INT TERM
