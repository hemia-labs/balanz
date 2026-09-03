#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $(id -u) -ne 0 || ${BALANZ_DISPOSABLE_CONTAINER:-} != phase0-runtime-isolation-v1 ||
      ! -f /.dockerenv ]]; then
  echo "rollback smoke is restricted to the designated disposable Docker container" >&2
  exit 77
fi
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
smoke_root=$(mktemp -d "${TMPDIR:-/tmp}/balanz-deploy-smoke.XXXXXX")
getent group balanz-api-config >/dev/null || groupadd --system balanz-api-config
getent group balanz-worker-config >/dev/null || groupadd --system balanz-worker-config

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n $smoke_root && -d $smoke_root && $(basename -- "$smoke_root") == balanz-deploy-smoke.* ]]; then
    rm -rf -- "$smoke_root" || status=1
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

bash "$repo_root/scripts/deploy/smoke-pm2-persistence.sh"

deploy_root="$smoke_root/deploy"
releases_root="$deploy_root/releases"
previous_release="$releases_root/previous"
candidate_one="$releases_root/candidate-one"
candidate_two="$releases_root/candidate-two"
candidate_three="$releases_root/candidate-three"
candidate_four="$releases_root/candidate-four"
fake_bin="$smoke_root/bin"
state_file="$smoke_root/pm2.state"
process_release_file="$smoke_root/pm2-process-release.state"
dump_file="$deploy_root/.pm2/dump.pm2"
dump_backup_file="$deploy_root/.pm2/dump.pm2.bak"
log_file="$smoke_root/pm2.log"
systemctl_state_file="$smoke_root/systemctl.state"
systemctl_log_file="$smoke_root/systemctl.log"
pm2_daemon_state_file="$smoke_root/pm2-daemon.state"
pm2_pid_file="$deploy_root/.pm2/pm2.pid"
pm2_fail_marker="$smoke_root/pm2.fail-once"
systemctl_fail_marker="$smoke_root/systemctl.fail-once"
signal_marker="$smoke_root/signal.once"

install -d -m 0700 \
  "$previous_release/apps/api/dist" \
  "$previous_release/apps/web" \
  "$previous_release/scripts/deploy" \
  "$deploy_root/.pm2" \
  "$deploy_root/runtime-config/previous/api" \
  "$fake_bin"

cp -- "$repo_root/ecosystem.config.cjs" "$previous_release/ecosystem.config.cjs"
printf '%s\n' 'rollback-api-fixture' >"$previous_release/apps/api/dist/main.js"
printf '%s\n' 'rollback-worker-fixture' >"$previous_release/apps/api/dist/worker.js"
# The fixture must retain its positional expansion.
# shellcheck disable=SC2016
printf '%s\n' '#!/usr/bin/env bash' '[[ ${2:-} == --check ]]' > \
  "$previous_release/scripts/deploy/run-isolated-runtime.sh"
printf '%s\n' 'previous-api-runtime-config' > \
  "$deploy_root/runtime-config/previous/api/runtime.env"
chgrp balanz-api-config "$deploy_root/runtime-config/previous/api/runtime.env"
chmod 0640 "$deploy_root/runtime-config/previous/api/runtime.env"

# These single-quoted fixture lines must be expanded by the fake PM2 process.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -u' \
  'command_name=${1:-}' \
  'shift || true' \
  'state=${SMOKE_PM2_STATE:?}' \
  'dump=${SMOKE_PM2_DUMP:?}' \
  'log=${SMOKE_PM2_LOG:?}' \
  'daemon_state=${SMOKE_PM2_DAEMON_STATE:?}' \
  'process_release_file=${SMOKE_PM2_PROCESS_RELEASE:?}' \
  'pid_file=${SMOKE_PM2_PID_FILE:?}' \
  'has_process() { grep -Fqx -- "$1" "$state" 2>/dev/null; }' \
  'add_process() { has_process "$1" || printf "%s\\n" "$1" >>"$state"; }' \
  'delete_process() {' \
  '  local temporary' \
  '  temporary="${state}.tmp"' \
  '  awk -v target="$1" '\''$0 != target'\'' "$state" 2>/dev/null >"$temporary" || true' \
  '  mv -f -- "$temporary" "$state"' \
  '}' \
  'write_dump() {' \
  '  local temporary process_release' \
  '  temporary="${dump}.tmp"' \
  '  process_release=$(cat -- "$process_release_file")' \
  '  [[ ! -f $dump ]] || cp -- "$dump" "${dump}.bak"' \
  '  /usr/local/bin/node -e '\''const fs=require("node:fs"); const path=require("node:path"); const [state,output,root]=process.argv.slice(1); const profile={"balanz-web-dev":"web","balanz-api-dev":"api","balanz-worker-dev":"worker"}; const names=fs.readFileSync(state,"utf8").split(/\r?\n/).filter(Boolean); fs.writeFileSync(output,JSON.stringify(names.map(name=>({name,pm_cwd:root,pm_exec_path:path.join(root,"scripts/deploy/run-isolated-runtime.sh"),exec_interpreter:"/bin/bash",args:[profile[name]]})))+"\n")'\'' "$state" "$temporary" "$process_release"' \
  '  mv -f -- "$temporary" "$dump"' \
  '  chmod 0600 -- "$dump" "${dump}.bak" 2>/dev/null || true' \
  '}' \
  'printf "%s %s\\n" "$command_name" "$*" >>"$log"' \
  'if [[ $command_name != kill && $(cat -- "$daemon_state") != running ]]; then' \
  '  printf "%s\\n" running >"$daemon_state"' \
  '  printf "%s\\n" 999999 >"$pid_file"' \
  '  printf "%s\\n" "auto-spawn $command_name" >>"$log"' \
  'fi' \
  'if [[ ${SMOKE_PM2_FAIL_COMMAND:-} == "$command_name" &&' \
  '      ! -e ${SMOKE_PM2_FAIL_MARKER:?} ]]; then' \
  '  : >"$SMOKE_PM2_FAIL_MARKER"' \
  '  exit 75' \
  'fi' \
  'case "$command_name" in' \
  '  describe) has_process "$1" ;;' \
  '  delete|stop)' \
  '    if [[ ${1:-} == all ]]; then : >"$state"; else delete_process "$1"; fi' \
  '    ;;' \
  '  jlist)' \
  '    /usr/local/bin/node -e '\''const fs=require("node:fs"); const path=require("node:path"); const [state,rootFile]=process.argv.slice(1); const root=fs.readFileSync(rootFile,"utf8").trim(); const profile={"balanz-web-dev":"web","balanz-api-dev":"api","balanz-worker-dev":"worker"}; const names=fs.readFileSync(state,"utf8").split(/\r?\n/).filter(Boolean); process.stdout.write(JSON.stringify(names.map(name=>({name,pm2_env:{name,pm_cwd:root,pm_exec_path:path.join(root,"scripts/deploy/run-isolated-runtime.sh"),exec_interpreter:"/bin/bash",args:[profile[name]]}}))))'\'' "$state" "$process_release_file"' \
  '    ;;' \
  '  save)' \
  '    if [[ ${1:-} == --force || -s $state ]]; then write_dump; fi' \
  '    ;;' \
  '  kill)' \
  '    : >"$state"' \
  '    printf "%s\\n" stopped >"$daemon_state"' \
  '    rm -f -- "$pid_file"' \
  '    ;;' \
  '  startOrRestart|startOrReload)' \
  '    config=${1:?}' \
  '    dirname -- "$(realpath -e -- "$config")" >"$process_release_file"' \
  '    only=""' \
  '    shift' \
  '    while (($#)); do' \
  '      if [[ $1 == --only ]]; then only=${2:?}; shift 2; else shift; fi' \
  '    done' \
  '    if [[ -n $only ]]; then' \
  '      IFS=, read -r -a names <<<"$only"' \
  '      for name in "${names[@]}"; do add_process "$name"; done' \
  '    else' \
  '      add_process balanz-web-dev' \
  '      add_process balanz-api-dev' \
  '      if grep -Fq -- balanz-worker-dev "$config"; then add_process balanz-worker-dev; fi' \
  '    fi' \
  '    ;;' \
  '  *) echo "unexpected fake PM2 command" >&2; exit 64 ;;' \
  'esac' >"$fake_bin/pm2"

# These single-quoted fixture lines must be expanded by the fake curl process.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -u' \
  'url=""' \
  'for argument in "$@"; do url=$argument; done' \
  'case ${SMOKE_CURL_MODE:-success}:$url in' \
  '  fail-old:*3021/api/v1) exit 22 ;;' \
  '  fail-current:*3021/readiness) exit 22 ;;' \
  '  tamper-current:*3021/readiness)' \
  '    rm -f -- "${SMOKE_TAMPER_MARKER:?}"' \
  '    exit 22' \
  '    ;;' \
  '  fail-after-restart:*3021/readiness)' \
  '    [[ $(cat -- "${SMOKE_SYSTEMCTL_STATE:?}") != active ]] || exit 22' \
  '    ;;' \
  '  *) exit 0 ;;' \
  'esac' >"$fake_bin/curl"
chmod 0700 -- "$fake_bin/pm2" "$fake_bin/curl"

# These single-quoted fixture lines must be expanded by the fake systemctl process.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -u' \
  'command_name=${1:-}' \
  'shift || true' \
  'state=${SMOKE_SYSTEMCTL_STATE:?}' \
  'log=${SMOKE_SYSTEMCTL_LOG:?}' \
  'process_state=${SMOKE_PM2_STATE:?}' \
  'dump=${SMOKE_PM2_DUMP:?}' \
  'daemon_state=${SMOKE_PM2_DAEMON_STATE:?}' \
  'process_release_file=${SMOKE_PM2_PROCESS_RELEASE:?}' \
  'pid_file=${SMOKE_PM2_PID_FILE:?}' \
  'printf "%s %s\\n" "$command_name" "$*" >>"$log"' \
  'if [[ ${SMOKE_SYSTEMCTL_FAIL_COMMAND:-} == "$command_name" &&' \
  '      ! -e ${SMOKE_SYSTEMCTL_FAIL_MARKER:?} ]]; then' \
  '  : >"$SMOKE_SYSTEMCTL_FAIL_MARKER"' \
  '  exit 1' \
  'fi' \
  'case "$command_name" in' \
  '  restart)' \
  '    temporary="${process_state}.resurrect"' \
  '    if ! /usr/local/bin/node -e '\''const fs=require("node:fs"); for(const item of JSON.parse(fs.readFileSync(process.argv[1],"utf8"))) console.log(item.name)'\'' "$dump" >"$temporary" 2>/dev/null; then' \
  '      /usr/local/bin/node -e '\''const fs=require("node:fs"); for(const item of JSON.parse(fs.readFileSync(process.argv[1],"utf8"))) console.log(item.name)'\'' "${dump}.bak" >"$temporary"' \
  '    fi' \
  '    mv -f -- "$temporary" "$process_state"' \
  '    /usr/local/bin/node -e '\''const fs=require("node:fs"); const items=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(items[0]) fs.writeFileSync(process.argv[2],items[0].pm_cwd+"\n")'\'' "$dump" "$process_release_file" 2>/dev/null || /usr/local/bin/node -e '\''const fs=require("node:fs"); const items=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(items[0]) fs.writeFileSync(process.argv[2],items[0].pm_cwd+"\n")'\'' "${dump}.bak" "$process_release_file"' \
  '    chmod 0666 -- "$process_state"' \
  '    printf "%s\\n" active >"$state"' \
  '    printf "%s\\n" running >"$daemon_state"' \
  '    printf "%s\\n" 999999 >"$pid_file"' \
  '    ;;' \
  '  stop)' \
  '    if [[ $(cat -- "$state") == active ]]; then' \
  '      : >"$process_state"' \
  '      printf "%s\\n" stopped >"$daemon_state"' \
  '      rm -f -- "$pid_file"' \
  '    fi' \
  '    printf "%s\\n" inactive >"$state"' \
  '    ;;' \
  '  is-active)' \
  '    [[ $# -eq 2 && ${1:-} == --quiet && ${2:-} == balanz-pm2.service ]] || exit 64' \
  '    [[ $(cat -- "$state") == active ]] && exit 0' \
  '    exit "${SMOKE_SYSTEMCTL_INACTIVE_RC:-3}"' \
  '    ;;' \
  '  *) echo "unexpected fake systemctl command" >&2; exit 64 ;;' \
  'esac' >"$fake_bin/systemctl"
chmod 0700 -- "$fake_bin/systemctl"

cat >"$fake_bin/mv" <<'SMOKE_MV'
#!/usr/bin/env bash
set -u
target=${!#}
/usr/bin/mv "$@"
if [[ ${SMOKE_SIGNAL_AFTER_CURRENT_SWITCH:-false} == true && $target == */current &&
      ! -e ${SMOKE_SIGNAL_MARKER:?} ]]; then
  : >"$SMOKE_SIGNAL_MARKER"
  kill -TERM "$PPID"
fi
SMOKE_MV
chmod 0700 -- "$fake_bin/mv"

make_candidate() {
  local candidate=$1
  local candidate_id
  candidate_id=$(basename -- "$candidate")
  install -d -m 0700 \
    "$candidate/apps/api/dist" \
    "$candidate/apps/web" \
    "$candidate/scripts/deploy" \
    "$deploy_root/runtime-config/$candidate_id/api" \
    "$deploy_root/runtime-config/$candidate_id/worker" \
    "$deploy_root/runtime-config/$candidate_id/migrator"
  cp -- "$repo_root/ecosystem.config.cjs" "$candidate/ecosystem.config.cjs"
  cp -- \
    "$repo_root/scripts/deploy/activate-release.sh" \
    "$repo_root/scripts/deploy/cleanup-inactive-release-runtime-credentials.sh" \
    "$repo_root/scripts/deploy/pause-managed-worker.sh" \
    "$repo_root/scripts/deploy/persist-pm2-state.sh" \
    "$repo_root/scripts/deploy/preflight-release-topology.sh" \
    "$repo_root/scripts/deploy/hash-release-artifact.cjs" \
    "$repo_root/scripts/deploy/validate-ecosystem.cjs" \
    "$repo_root/scripts/deploy/verify-rollback-api-compatibility.sh" \
    "$candidate/scripts/deploy/"
  printf '%s\n' 'candidate-api-fixture' >"$candidate/apps/api/dist/main.js"
  printf '%s\n' 'candidate-worker-fixture' >"$candidate/apps/api/dist/worker.js"
  # The fixture must retain its positional expansion.
  # shellcheck disable=SC2016
  printf '%s\n' '#!/usr/bin/env bash' '[[ ${2:-} == --check ]]' > \
    "$candidate/scripts/deploy/run-isolated-runtime.sh"
  printf '%s\n' 'candidate-api-runtime-config' > \
    "$deploy_root/runtime-config/$candidate_id/api/runtime.env"
  printf '%s\n' 'candidate-worker-runtime-config' > \
    "$deploy_root/runtime-config/$candidate_id/worker/runtime.env"
  chgrp balanz-api-config \
    "$deploy_root/runtime-config/$candidate_id/api/runtime.env"
  chgrp balanz-worker-config \
    "$deploy_root/runtime-config/$candidate_id/worker/runtime.env"
  chmod 0640 \
    "$deploy_root/runtime-config/$candidate_id/api/runtime.env" \
    "$deploy_root/runtime-config/$candidate_id/worker/runtime.env"
}

assert_present() {
  grep -Fqx -- "$1" "$state_file" || {
    echo "expected PM2 process is absent: $1" >&2
    exit 1
  }
}

assert_absent() {
  if grep -Fqx -- "$1" "$state_file"; then
    echo "unexpected PM2 process is present: $1" >&2
    exit 1
  fi
}

assert_dump_processes() {
  local expected_release=$1
  shift
  /usr/local/bin/node -e '
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const [primaryPath, backupPath, expectedRelease, ...expectedNames] = process.argv.slice(1);
    const primary = JSON.parse(fs.readFileSync(primaryPath, "utf8"));
    const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    const profiles = {"balanz-web-dev":"web","balanz-api-dev":"api","balanz-worker-dev":"worker"};
    const names = (entries) => entries.map((entry) => {
      assert.equal(entry.pm_cwd, expectedRelease);
      assert.equal(entry.pm_exec_path, path.join(expectedRelease, "scripts/deploy/run-isolated-runtime.sh"));
      assert.equal(entry.exec_interpreter, "/bin/bash");
      assert.deepStrictEqual(entry.args, [profiles[entry.name]]);
      return entry.name;
    }).sort();
    assert.deepStrictEqual(primary, backup);
    assert.deepStrictEqual(names(primary), expectedNames.sort());
  ' "$dump_file" "$dump_backup_file" "$expected_release" "$@"
}

make_candidate "$candidate_one"
make_candidate "$candidate_two"
make_candidate "$candidate_three"
node "$candidate_one/scripts/deploy/validate-ecosystem.cjs" \
  "$candidate_one/ecosystem.config.cjs" \
  "$candidate_one/apps/api" \
  current
node "$candidate_one/scripts/deploy/validate-ecosystem.cjs" \
  "$candidate_one/ecosystem.config.cjs" \
  "$candidate_one/apps/api" \
  rollback-api
ln -s -- "$previous_release" "$deploy_root/current"
printf '%s\n' balanz-web-dev balanz-api-dev balanz-worker-dev >"$state_file"
printf '%s\n' "$previous_release" >"$process_release_file"
printf '%s\n' \
  '[{"name":"balanz-web-dev"},{"name":"balanz-api-dev"},{"name":"balanz-worker-dev"}]' > \
  "$dump_file"
cp -- "$dump_file" "$dump_backup_file"
chmod 0600 -- "$dump_file" "$dump_backup_file"
: >"$log_file"
printf '%s\n' active >"$systemctl_state_file"
: >"$systemctl_log_file"
printf '%s\n' running >"$pm2_daemon_state_file"
printf '%s\n' 999999 >"$pm2_pid_file"

export PATH="$fake_bin:$PATH"
export SMOKE_PM2_STATE="$state_file"
export SMOKE_PM2_PROCESS_RELEASE="$process_release_file"
export SMOKE_PM2_DUMP="$dump_file"
export SMOKE_PM2_LOG="$log_file"
export SMOKE_SYSTEMCTL_STATE="$systemctl_state_file"
export SMOKE_SYSTEMCTL_LOG="$systemctl_log_file"
export SMOKE_PM2_DAEMON_STATE="$pm2_daemon_state_file"
export SMOKE_PM2_PID_FILE="$pm2_pid_file"
export SMOKE_PM2_FAIL_MARKER="$pm2_fail_marker"
export SMOKE_SYSTEMCTL_FAIL_MARKER="$systemctl_fail_marker"
export SMOKE_SIGNAL_MARKER="$signal_marker"
export SMOKE_CURL_MODE=success
export BALANZ_DEPLOY_SMOKE_PM2="$fake_bin/pm2"
export BALANZ_DEPLOY_SMOKE_SYSTEMCTL="$fake_bin/systemctl"

bash "$candidate_one/scripts/deploy/pause-managed-worker.sh" \
  "$candidate_one" "$deploy_root"
assert_absent balanz-worker-dev
bash "$candidate_one/scripts/deploy/verify-rollback-api-compatibility.sh" \
  "$candidate_one" \
  "$deploy_root"
assert_absent balanz-worker-dev

printf '%s\n' 'tampered-transitive-module' > \
  "$previous_release/apps/api/dist/transitive-module.js"
if bash "$candidate_one/scripts/deploy/activate-release.sh" \
  "$candidate_one" \
  "$deploy_root" >/dev/null 2>&1; then
  echo "activation accepted a changed transitive rollback artifact" >&2
  exit 1
fi
rm -f -- "$previous_release/apps/api/dist/transitive-module.js"
[[ $(readlink -f -- "$deploy_root/current") == "$previous_release" ]]

export SMOKE_CURL_MODE=fail-current
if bash "$candidate_one/scripts/deploy/activate-release.sh" "$candidate_one" "$deploy_root"; then
  echo "activation unexpectedly passed with a failing readiness probe" >&2
  exit 1
fi
[[ $(readlink -f -- "$deploy_root/current") == "$previous_release" ]]
assert_present balanz-web-dev
assert_present balanz-api-dev
assert_absent balanz-worker-dev

export SMOKE_CURL_MODE=success
bash "$candidate_two/scripts/deploy/verify-rollback-api-compatibility.sh" \
  "$candidate_two" \
  "$deploy_root"
export SMOKE_CURL_MODE=tamper-current
export SMOKE_TAMPER_MARKER="$candidate_two/.rollback-api-compatible"
rollback_status=0
bash "$candidate_two/scripts/deploy/activate-release.sh" \
  "$candidate_two" \
  "$deploy_root" || rollback_status=$?
if [[ $rollback_status -ne 75 ]]; then
  echo "fail-closed rollback returned unexpected status $rollback_status" >&2
  exit 1
fi
[[ $(readlink -f -- "$deploy_root/current") == "$candidate_two" ]]
assert_absent balanz-web-dev
assert_absent balanz-api-dev
assert_absent balanz-worker-dev
assert_dump_processes "$candidate_two"
[[ $(cat -- "$systemctl_state_file") == inactive ]]
[[ $(cat -- "$pm2_daemon_state_file") == stopped ]]
[[ ! -e $pm2_pid_file && ! -L $pm2_pid_file ]]

ln -sfn -- "$previous_release" "$deploy_root/current"
printf '%s\n' balanz-web-dev balanz-api-dev >"$state_file"
printf '%s\n' '[{"name":"balanz-web-dev"},{"name":"balanz-api-dev"}]' >"$dump_file"
cp -- "$dump_file" "$dump_backup_file"
chmod 0600 -- "$dump_file" "$dump_backup_file"
printf '%s\n' active >"$systemctl_state_file"
printf '%s\n' running >"$pm2_daemon_state_file"
printf '%s\n' 999999 >"$pm2_pid_file"
export SMOKE_CURL_MODE=fail-old
verification_status=0
bash "$candidate_three/scripts/deploy/verify-rollback-api-compatibility.sh" \
  "$candidate_three" \
  "$deploy_root" || verification_status=$?
if [[ $verification_status -eq 0 ]]; then
  echo "rollback API compatibility unexpectedly passed a failed cold-start probe" >&2
  exit 1
fi
[[ ! -e $candidate_three/.rollback-api-compatible ]]
assert_absent balanz-web-dev
assert_absent balanz-api-dev
assert_absent balanz-worker-dev

ln -sfn -- "$candidate_one" "$deploy_root/current"
printf '%s\n' balanz-web-dev balanz-api-dev >"$state_file"
export SMOKE_CURL_MODE=success
bash "$candidate_three/scripts/deploy/verify-rollback-api-compatibility.sh" \
  "$candidate_three" \
  "$deploy_root"
[[ -f $candidate_three/.rollback-api-compatible ]]
assert_present balanz-web-dev
assert_present balanz-api-dev
assert_absent balanz-worker-dev

export SMOKE_SIGNAL_AFTER_CURRENT_SWITCH=true
rm -f -- "$signal_marker"
signal_status=0
bash "$candidate_three/scripts/deploy/activate-release.sh" \
  "$candidate_three" \
  "$deploy_root" || signal_status=$?
unset SMOKE_SIGNAL_AFTER_CURRENT_SWITCH
if [[ $signal_status -ne 143 ]]; then
  echo "activation signal test returned unexpected status $signal_status" >&2
  exit 1
fi
[[ $(readlink -f -- "$deploy_root/current") == "$candidate_one" ]]
assert_present balanz-web-dev
assert_present balanz-api-dev
assert_absent balanz-worker-dev

bash "$candidate_one/scripts/deploy/cleanup-inactive-release-runtime-credentials.sh" \
  "$candidate_one" \
  "$deploy_root"
[[ -f $deploy_root/runtime-config/candidate-one/api/runtime.env ]]
[[ -f $deploy_root/runtime-config/candidate-one/worker/runtime.env ]]
[[ -f $deploy_root/runtime-config/previous/api/runtime.env ]]
[[ ! -e $deploy_root/runtime-config/previous/worker ]]
[[ ! -e $deploy_root/runtime-config/candidate-two ]]
[[ ! -e $deploy_root/runtime-config/candidate-three ]]
ln -sfn -- "$previous_release" "$deploy_root/current"
bash "$candidate_one/scripts/deploy/cleanup-inactive-release-runtime-credentials.sh" \
  "$candidate_one" \
  "$deploy_root"
[[ ! -e $deploy_root/runtime-config/candidate-one ]]

make_candidate "$candidate_four"
rm -f -- "$deploy_root/current"
: >"$state_file"
: >"$systemctl_log_file"
printf '%s\n' \
  '[{"name":"balanz-web-dev"},{"name":"balanz-api-dev"},{"name":"balanz-worker-dev"}]' > \
  "$dump_file"
cp -- "$dump_file" "$dump_backup_file"
chmod 0600 -- "$dump_file" "$dump_backup_file"
printf '%s\n' inactive >"$systemctl_state_file"
printf '%s\n' stopped >"$pm2_daemon_state_file"
rm -f -- "$pm2_pid_file"
export SMOKE_CURL_MODE=fail-after-restart
first_deploy_status=0
bash "$candidate_four/scripts/deploy/activate-release.sh" \
  "$candidate_four" \
  "$deploy_root" || first_deploy_status=$?
if [[ $first_deploy_status -eq 0 ]]; then
  echo "first deployment unexpectedly passed a second-round readiness failure" >&2
  exit 1
fi
[[ ! -e $deploy_root/current && ! -L $deploy_root/current ]]
[[ ! -s $state_file ]]
assert_absent balanz-web-dev
assert_absent balanz-api-dev
assert_absent balanz-worker-dev
if "$fake_bin/systemctl" is-active --quiet balanz-pm2.service; then
  echo "first-deployment rollback left the PM2 unit active" >&2
  exit 1
fi
[[ $(cat -- "$systemctl_state_file") == inactive ]]
[[ $(cat -- "$pm2_daemon_state_file") == stopped ]]
[[ ! -e $pm2_pid_file && ! -L $pm2_pid_file ]]
assert_dump_processes "$candidate_four"
[[ $(tail -n 1 -- "$log_file") =~ ^kill[[:space:]]*$ ]]
grep -Fqx -- 'restart balanz-pm2.service' "$systemctl_log_file"
grep -Fqx -- 'stop balanz-pm2.service' "$systemctl_log_file"
printf '%s\n' 'rollback smoke checkpoint: first-deployment failure is fail-closed'

printf '%s\n' '{corrupt-primary' >"$dump_file"
"$fake_bin/systemctl" restart balanz-pm2.service
[[ ! -s $state_file ]]
"$fake_bin/systemctl" stop balanz-pm2.service
[[ $(cat -- "$systemctl_state_file") == inactive ]]
[[ $(cat -- "$pm2_daemon_state_file") == stopped ]]
[[ ! -e $pm2_pid_file && ! -L $pm2_pid_file ]]
rm -f -- "$dump_file"
"$fake_bin/systemctl" restart balanz-pm2.service
[[ ! -s $state_file ]]
"$fake_bin/systemctl" stop balanz-pm2.service
[[ $(cat -- "$pm2_daemon_state_file") == stopped ]]
[[ ! -e $pm2_pid_file && ! -L $pm2_pid_file ]]
printf '%s\n' 'rollback smoke checkpoint: corrupt and missing primary use the empty backup'

export SMOKE_CURL_MODE=success
bash "$candidate_four/scripts/deploy/activate-release.sh" \
  "$candidate_four" \
  "$deploy_root"
[[ $(readlink -f -- "$deploy_root/current") == "$candidate_four" ]]
"$fake_bin/systemctl" is-active --quiet balanz-pm2.service
[[ $(cat -- "$pm2_daemon_state_file") == running ]]
[[ -f $pm2_pid_file && ! -L $pm2_pid_file ]]
assert_present balanz-web-dev
assert_present balanz-api-dev
assert_present balanz-worker-dev
[[ $(sort -u -- "$state_file" | wc -l) -eq 3 ]]
assert_dump_processes \
  "$candidate_four" balanz-api-dev balanz-web-dev balanz-worker-dev
printf '%s\n' 'rollback smoke checkpoint: clean first-deployment retry is active'

reset_candidate_four_control_plane() {
  unset SMOKE_PM2_FAIL_COMMAND SMOKE_SYSTEMCTL_FAIL_COMMAND \
    SMOKE_SYSTEMCTL_INACTIVE_RC
  rm -f -- "$pm2_fail_marker" "$systemctl_fail_marker"
  : >"$state_file"
  printf '%s\n' "$candidate_four" >"$process_release_file"
  printf '%s\n' inactive >"$systemctl_state_file"
  printf '%s\n' stopped >"$pm2_daemon_state_file"
  rm -f -- "$pm2_pid_file"
  (
    cd "$candidate_four"
    "$fake_bin/pm2" startOrReload ecosystem.config.cjs --update-env >/dev/null
  )
  "$fake_bin/pm2" save --force >/dev/null
  "$fake_bin/pm2" save --force >/dev/null
  "$fake_bin/systemctl" restart balanz-pm2.service
}

assert_fail_closed_control_plane() {
  [[ ! -s $state_file ]]
  [[ $(cat -- "$systemctl_state_file") == inactive ]]
  [[ $(cat -- "$pm2_daemon_state_file") == stopped ]]
  [[ ! -e $pm2_pid_file && ! -L $pm2_pid_file ]]
  assert_dump_processes "$candidate_four"
}

reset_candidate_four_control_plane
export SMOKE_PM2_FAIL_COMMAND=delete
rm -f -- "$pm2_fail_marker"
delete_fault_status=0
bash "$candidate_four/scripts/deploy/pause-managed-worker.sh" \
  "$candidate_four" "$deploy_root" >/dev/null 2>&1 || delete_fault_status=$?
[[ $delete_fault_status -eq 75 ]]
unset SMOKE_PM2_FAIL_COMMAND
assert_fail_closed_control_plane
printf '%s\n' 'rollback smoke checkpoint: delete fault is fail-closed'

reset_candidate_four_control_plane
export SMOKE_PM2_FAIL_COMMAND=save
rm -f -- "$pm2_fail_marker"
save_fault_status=0
bash "$candidate_four/scripts/deploy/pause-managed-worker.sh" \
  "$candidate_four" "$deploy_root" >/dev/null 2>&1 || save_fault_status=$?
[[ $save_fault_status -eq 75 ]]
unset SMOKE_PM2_FAIL_COMMAND
assert_fail_closed_control_plane
printf '%s\n' 'rollback smoke checkpoint: save fault is fail-closed'

reset_candidate_four_control_plane
printf '%s\n' "$candidate_three" >"$process_release_file"
rogue_path_status=0
bash "$candidate_four/scripts/deploy/pause-managed-worker.sh" \
  "$candidate_four" "$deploy_root" >/dev/null 2>&1 || rogue_path_status=$?
[[ $rogue_path_status -eq 75 ]]
assert_fail_closed_control_plane
printf '%s\n' 'rollback smoke checkpoint: homonymous path fault is fail-closed'

reset_candidate_four_control_plane
export SMOKE_PM2_FAIL_COMMAND=save
export SMOKE_SYSTEMCTL_FAIL_COMMAND=stop
rm -f -- "$pm2_fail_marker" "$systemctl_fail_marker"
systemctl_fault_status=0
bash "$candidate_four/scripts/deploy/pause-managed-worker.sh" \
  "$candidate_four" "$deploy_root" >/dev/null 2>&1 || systemctl_fault_status=$?
[[ $systemctl_fault_status -eq 75 ]]
unset SMOKE_PM2_FAIL_COMMAND SMOKE_SYSTEMCTL_FAIL_COMMAND
assert_fail_closed_control_plane
printf '%s\n' 'rollback smoke checkpoint: systemctl stop fault is fail-closed'

reset_candidate_four_control_plane
export SMOKE_PM2_FAIL_COMMAND=save
export SMOKE_SYSTEMCTL_INACTIVE_RC=4
rm -f -- "$pm2_fail_marker"
inactive_rc_status=0
bash "$candidate_four/scripts/deploy/pause-managed-worker.sh" \
  "$candidate_four" "$deploy_root" >/dev/null 2>&1 || inactive_rc_status=$?
[[ $inactive_rc_status -eq 75 ]]
unset SMOKE_PM2_FAIL_COMMAND SMOKE_SYSTEMCTL_INACTIVE_RC
assert_fail_closed_control_plane
printf '%s\n' 'rollback smoke checkpoint: noncanonical inactive status is rejected'

if grep -Eq 'startOr(Restart|Reload).*--only balanz-web-dev,balanz-api-dev' "$log_file" &&
  ! grep -Eq 'startOr(Restart|Reload).*--only .*balanz-worker-dev' "$log_file"; then
  printf '%s\n' 'rollback smoke passed: optional previous worker stayed removed and fail-closed evidence was enforced'
else
  echo "rollback smoke did not exercise the expected PM2 process set" >&2
  exit 1
fi
