#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $(id -u) -ne 0 || ${BALANZ_DISPOSABLE_CONTAINER:-} != phase0-runtime-isolation-v1 ||
      ! -f /.dockerenv ]]; then
  echo "legacy cutover smoke is restricted to the designated disposable Docker container" >&2
  exit 77
fi
if [[ ! -x /usr/bin/sudo || -L /usr/bin/sudo ||
      ! -x /usr/local/bin/node || -L /usr/local/bin/node ||
      $(/usr/local/bin/node -p 'process.versions.node') != 22.22.0 ||
      -e /usr/local/bin/bun || -L /usr/local/bin/bun ]]; then
  echo "legacy cutover smoke image does not match the pinned control-plane profile" >&2
  exit 69
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
smoke_root=$(mktemp -d /tmp/balanz-legacy-cutover.XXXXXX)
chmod 0777 "$smoke_root"
home_lure=${HOME:?}
[[ $home_lure != /home/deploy ]]
deploy_root=/srv/apps/balanz
legacy_id=e3d4f432dca1df6bbd0877d86e60bd52d8c15325
legacy_hash=5cfc0f281b9bed7c8d98f3f930cb83b6ef24b4640f88dff961b91023a807b2f9
legacy_release="$deploy_root/releases/$legacy_id"
fake_bin="$smoke_root/bin"
pm2_state="$smoke_root/pm2.state"
pm2_process_release="$smoke_root/pm2-process-release.state"
pm2_home="$deploy_root/.pm2"
pm2_dump="$pm2_home/dump.pm2"
pm2_dump_backup="$pm2_home/dump.pm2.bak"
legacy_pm2_home=/home/deploy/.pm2
legacy_pm2_dump="$legacy_pm2_home/dump.pm2"
legacy_pm2_dump_backup="$legacy_pm2_home/dump.pm2.bak"
pm2_log="$smoke_root/pm2.log"
pm2_context_log="$smoke_root/pm2-context.log"
systemctl_state="$smoke_root/systemctl.state"
systemctl_log="$smoke_root/systemctl.log"
pm2_daemon_state="$smoke_root/pm2-daemon.state"
pm2_pid="$deploy_root/.pm2/pm2.pid"
rogue_launcher=''

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n $rogue_launcher ]]; then
    kill -KILL "$rogue_launcher" 2>/dev/null || true
    wait "$rogue_launcher" 2>/dev/null || true
  fi
  rm -f -- \
    /usr/local/bin/bun \
    /etc/sudoers.d/balanz-runtime-isolation \
    /etc/sudoers.d/balanz-legacy-smoke \
    /etc/systemd/system/balanz-pm2.service
  if [[ -d /var/lib/balanz-runtime-isolation &&
        ! -L /var/lib/balanz-runtime-isolation ]]; then
    rm -rf -- /var/lib/balanz-runtime-isolation || status=1
  fi
  if [[ -d $deploy_root && $deploy_root == /srv/apps/balanz ]]; then
    rm -rf -- "$deploy_root" || status=1
  fi
  if [[ -d /srv/apps/balanz-deploy ]]; then
    rm -rf -- /srv/apps/balanz-deploy || status=1
  fi
  if [[ -d $smoke_root && $(basename -- "$smoke_root") == balanz-legacy-cutover.* ]]; then
    rm -rf -- "$smoke_root" || status=1
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[[ ! -e $deploy_root && ! -L $deploy_root && ! -e /srv/apps/balanz-deploy &&
    ! -e /var/lib/balanz-runtime-isolation && ! -L /var/lib/balanz-runtime-isolation ]] || {
  echo "disposable image unexpectedly contains Balanz deployment state" >&2
  exit 77
}
for identity in deploy balanz-deploy balanz-web balanz-api balanz-worker balanz-migrator; do
  ! getent passwd "$identity" >/dev/null || {
    echo "disposable image unexpectedly contains identity $identity" >&2
    exit 77
  }
done

container_hostname=$(hostname)
grep -Eq "(^|[[:space:]])${container_hostname//./\\.}([[:space:]]|$)" /etc/hosts ||
  printf '127.0.0.1 %s\n' "$container_hostname" >>/etc/hosts
install -d -m 0755 "$fake_bin"
: >"$pm2_state"
: >"$pm2_process_release"
: >"$pm2_log"
: >"$pm2_context_log"
: >"$systemctl_state"
: >"$systemctl_log"
printf '%s\n' running >"$pm2_daemon_state"
chmod 0666 \
  "$pm2_state" \
  "$pm2_process_release" \
  "$pm2_log" \
  "$pm2_context_log" \
  "$systemctl_state" \
  "$systemctl_log" \
  "$pm2_daemon_state"

cat >"$fake_bin/pm2" <<'FAKE_PM2'
#!/usr/bin/env bash
set -Eeuo pipefail
command_name=${1:-}
shift || true
state=${SMOKE_PM2_STATE:?}
log=${SMOKE_PM2_LOG:?}
context_log=${SMOKE_PM2_CONTEXT_LOG:?}
daemon_state=${SMOKE_PM2_DAEMON_STATE:?}
process_release_file=${SMOKE_PM2_PROCESS_RELEASE:?}
pm2_home=${PM2_HOME:-${SMOKE_PM2_HOME:?}}
dump="$pm2_home/dump.pm2"
pid_file="$pm2_home/pm2.pid"
has_process() { grep -Fqx -- "$1" "$state" 2>/dev/null; }
delete_process() {
  awk -v target="$1" '$0 != target' "$state" >"$state.tmp" || true
  mv -f -- "$state.tmp" "$state"
  chmod 0666 "$state"
}
write_dump() {
  local temporary process_release
  temporary="${dump}.tmp"
  process_release=$(cat -- "$process_release_file")
  [[ ! -f $dump ]] || cp -- "$dump" "${dump}.bak"
  /usr/local/bin/node -e 'const fs=require("node:fs"); const path=require("node:path"); const [state,output,root]=process.argv.slice(1); const profile={"balanz-web-dev":"web","balanz-api-dev":"api","balanz-worker-dev":"worker"}; const names=fs.readFileSync(state,"utf8").split(/\r?\n/).filter(Boolean); fs.writeFileSync(output,JSON.stringify(names.map(name=>({name,pm_cwd:root,pm_exec_path:path.join(root,"scripts/deploy/run-isolated-runtime.sh"),exec_interpreter:"/bin/bash",args:[profile[name]]})))+"\n")' "$state" "$temporary" "$process_release"
  mv -f -- "$temporary" "$dump"
  chmod 0600 -- "$dump"
  [[ ! -f ${dump}.bak ]] || chmod 0600 -- "${dump}.bak"
}
printf '%s %s\n' "$command_name" "$*" >>"$log"
printf '%s|%s\n' "${HOME:-unset}" "${PM2_HOME:-unset}" >>"$context_log"
if [[ $command_name != kill && $(cat -- "$daemon_state") != running ]]; then
  printf '%s\n' running >"$daemon_state"
  printf '%s\n' 999999 >"$pid_file"
  printf 'auto-spawn %s\n' "$command_name" >>"$log"
fi
case "$command_name" in
  describe) has_process "$1" ;;
  delete|stop)
    if [[ ${1:-} == all ]]; then : >"$state"; else delete_process "$1"; fi
    ;;
  jlist)
    /usr/local/bin/node -e 'const fs=require("node:fs"); const path=require("node:path"); const [state,rootFile]=process.argv.slice(1); const root=fs.readFileSync(rootFile,"utf8").trim(); const profile={"balanz-web-dev":"web","balanz-api-dev":"api","balanz-worker-dev":"worker"}; const names=fs.readFileSync(state,"utf8").split(/\r?\n/).filter(Boolean); process.stdout.write(JSON.stringify(names.map(name=>({name,pm2_env:{name,pm_cwd:root,pm_exec_path:path.join(root,"scripts/deploy/run-isolated-runtime.sh"),exec_interpreter:"/bin/bash",args:[profile[name]]}}))))' "$state" "$process_release_file"
    ;;
  save)
    if [[ ${1:-} == --force || -s $state ]]; then write_dump; fi
    ;;
  kill)
    : >"$state"
    printf '%s\n' stopped >"$daemon_state"
    rm -f -- "$pid_file"
    ;;
  startOrRestart)
    dirname -- "$(realpath -e -- "${1:?}")" >"$process_release_file"
    grep -Fqx balanz-api-dev "$state" || printf '%s\n' balanz-api-dev >>"$state"
    ;;
  startOrReload)
    dirname -- "$(realpath -e -- "${1:?}")" >"$process_release_file"
    for name in balanz-web-dev balanz-api-dev balanz-worker-dev; do
      grep -Fqx "$name" "$state" || printf '%s\n' "$name" >>"$state"
    done
    ;;
  *) echo 'unexpected fake PM2 command' >&2; exit 64 ;;
esac
FAKE_PM2

cat >"$fake_bin/runuser" <<'FAKE_RUNUSER'
#!/usr/bin/env bash
set -Eeuo pipefail
exec /usr/sbin/runuser --preserve-environment "$@"
FAKE_RUNUSER

cat >"$fake_bin/systemctl" <<'FAKE_SYSTEMCTL'
#!/usr/bin/env bash
set -Eeuo pipefail
state=${SMOKE_SYSTEMCTL_STATE:?}
log=${SMOKE_SYSTEMCTL_LOG:?}
process_state=${SMOKE_PM2_STATE:?}
pm2_home=${SMOKE_PM2_HOME:?}
dump="$pm2_home/dump.pm2"
daemon_state=${SMOKE_PM2_DAEMON_STATE:?}
process_release_file=${SMOKE_PM2_PROCESS_RELEASE:?}
pid_file="$pm2_home/pm2.pid"
command_name=${1:-}
shift || true
printf '%s %s\n' "$command_name" "$*" >>"$log"
has() { grep -Fqx -- "$1" "$state" 2>/dev/null; }
add() { has "$1" || printf '%s\n' "$1" >>"$state"; }
remove() {
  awk -v target="$1" '$0 != target' "$state" >"$state.tmp" || true
  mv -f -- "$state.tmp" "$state"
  chmod 0666 "$state"
}
case "$command_name" in
  cat) [[ ${1:-} == pm2-deploy.service ]] ;;
  disable)
    remove legacy-enabled
    remove legacy-active
    printf '%s\n' stopped >"$daemon_state"
    rm -f -- "$pid_file"
    ;;
  daemon-reload) exit 0 ;;
  enable)
    add new-enabled
    ;;
  restart)
    [[ ${1:-} == balanz-pm2.service ]]
    temporary="${process_state}.resurrect"
    if ! /usr/local/bin/node -e 'const fs=require("node:fs"); for(const item of JSON.parse(fs.readFileSync(process.argv[1],"utf8"))) console.log(item.name)' "$dump" >"$temporary" 2>/dev/null; then
      /usr/local/bin/node -e 'const fs=require("node:fs"); for(const item of JSON.parse(fs.readFileSync(process.argv[1],"utf8"))) console.log(item.name)' "${dump}.bak" >"$temporary"
    fi
    mv -f -- "$temporary" "$process_state"
    /usr/local/bin/node -e 'const fs=require("node:fs"); const items=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(items[0]) fs.writeFileSync(process.argv[2],items[0].pm_cwd+"\n")' "$dump" "$process_release_file" 2>/dev/null || /usr/local/bin/node -e 'const fs=require("node:fs"); const items=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(items[0]) fs.writeFileSync(process.argv[2],items[0].pm_cwd+"\n")' "${dump}.bak" "$process_release_file"
    chmod 0666 -- "$process_state"
    add new-active
    printf '%s\n' running >"$daemon_state"
    printf '%s\n' 999999 >"$pid_file"
    ;;
  stop)
    [[ ${1:-} == balanz-pm2.service ]]
    if has new-active; then
      : >"$process_state"
      printf '%s\n' stopped >"$daemon_state"
      rm -f -- "$pid_file"
    fi
    remove new-active
    ;;
  is-enabled)
    service=${!#}
    if [[ $service == pm2-deploy.service ]]; then has legacy-enabled; else has new-enabled; fi
    ;;
  is-active)
    [[ $# -eq 2 && ${1:-} == --quiet ]]
    service=${!#}
    if [[ $service == pm2-deploy.service ]]; then
      has legacy-active && exit 0
    else
      has new-active && exit 0
    fi
    exit 3
    ;;
  *) echo 'unexpected fake systemctl command' >&2; exit 64 ;;
esac
FAKE_SYSTEMCTL

cat >"$fake_bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -Eeuo pipefail
url=${!#}
if [[ ${SMOKE_CURL_MODE:-success} == fail-current && $url == *3021/readiness ]]; then
  exit 22
fi
exit 0
FAKE_CURL

cat >/usr/local/bin/bun <<'FAKE_BUN'
#!/usr/bin/env bash
[[ ${1:-} == --version ]] && { printf '%s\n' 1.3.2; exit 0; }
exit 64
FAKE_BUN
chmod 0755 \
  "$fake_bin/pm2" \
  "$fake_bin/runuser" \
  "$fake_bin/systemctl" \
  "$fake_bin/curl" \
  /usr/local/bin/bun

assert_dump_processes() {
  local primary=$1 backup=$2 expected_release=$3
  shift 3
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
  ' "$primary" "$backup" "$expected_release" "$@"
}

export BALANZ_DEPLOY_SMOKE_PM2="$fake_bin/pm2"
export BALANZ_DEPLOY_SMOKE_SYSTEMCTL="$fake_bin/systemctl"
export SMOKE_PM2_STATE="$pm2_state"
export SMOKE_PM2_PROCESS_RELEASE="$pm2_process_release"
export SMOKE_PM2_HOME="$pm2_home"
export SMOKE_PM2_LOG="$pm2_log"
export SMOKE_PM2_CONTEXT_LOG="$pm2_context_log"
export SMOKE_SYSTEMCTL_STATE="$systemctl_state"
export SMOKE_SYSTEMCTL_LOG="$systemctl_log"
export SMOKE_PM2_DAEMON_STATE="$pm2_daemon_state"
export PATH="$fake_bin:$PATH"
printf '%s\n' legacy-enabled legacy-active >"$systemctl_state"
printf '%s\n' balanz-web-dev balanz-api-dev >"$pm2_state"
printf '%s\n' "$legacy_release" >"$pm2_process_release"

useradd --create-home --user-group --home-dir /home/deploy --shell /bin/bash deploy
install -d -m 0700 -o deploy -g deploy \
  /home/deploy/.ssh \
  /home/deploy/.nvm \
  "$legacy_pm2_home"
printf '%s\n' '[{"name":"balanz-web-dev"},{"name":"balanz-api-dev"}]' > \
  "$legacy_pm2_dump"
cp -- "$legacy_pm2_dump" "$legacy_pm2_dump_backup"
chown deploy:deploy "$legacy_pm2_dump" "$legacy_pm2_dump_backup"
chmod 0600 "$legacy_pm2_dump" "$legacy_pm2_dump_backup"
printf '%s\n' 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakePhaseZeroCutoverKey smoke' > \
  /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 0600 /home/deploy/.ssh/authorized_keys
# The generated legacy shell expands $PATH when it is sourced.
# shellcheck disable=SC2016
printf 'export PATH=%q:$PATH\n' "$fake_bin" >/home/deploy/.nvm/nvm.sh
chown deploy:deploy /home/deploy/.nvm/nvm.sh
chmod 0644 /home/deploy/.nvm/nvm.sh

install -d -m 0755 \
  "$legacy_release/apps/api/dist" \
  "$legacy_release/apps/web" \
  "$deploy_root/shared"
cat >"$legacy_release/ecosystem.config.cjs" <<'LEGACY_ECOSYSTEM'
module.exports = {
  apps: [
    {
      name: "balanz-web-dev",
      cwd: `${__dirname}/apps/web`,
      script: "node_modules/next/dist/bin/next",
      args: "start --hostname 127.0.0.1 --port 5181",
      env: { NODE_ENV: "production" },
    },
    {
      name: "balanz-api-dev",
      cwd: `${__dirname}/apps/api`,
      script: "dist/main.js",
      env: { NODE_ENV: "production", APP_PORT: "3021" },
    },
  ],
};
LEGACY_ECOSYSTEM
[[ $(sha256sum "$legacy_release/ecosystem.config.cjs" | cut -d' ' -f1) == "$legacy_hash" ]]
printf '%s\n' 'legacy-api-fixture' >"$legacy_release/apps/api/dist/main.js"
printf '%s\n' 'LEGACY_DATABASE_CREDENTIAL=must-be-revoked' >"$deploy_root/shared/api.env"
chown -R deploy:deploy "$deploy_root"
chmod 0600 "$deploy_root/shared/api.env"
ln -s -- "$deploy_root/shared/api.env" "$legacy_release/apps/api/.env"
ln -s -- "$legacy_release" "$deploy_root/current"

confirmation="--acknowledge-legacy-cutover=$legacy_id"
printf '%s\n' '//tamper' >>"$legacy_release/ecosystem.config.cjs"
if bash "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh" \
  "$deploy_root" quiesce "$confirmation" >/dev/null 2>&1; then
  echo "bootstrap accepted a modified legacy ecosystem" >&2
  exit 1
fi
sed -i '$d' "$legacy_release/ecosystem.config.cjs"
[[ -f $deploy_root/shared/api.env && -f /home/deploy/.ssh/authorized_keys ]]
grep -Fqx balanz-api-dev "$pm2_state"

printf '%s\n' 'deploy ALL=(root) NOPASSWD: /bin/true' >/etc/sudoers.d/balanz-legacy-smoke
chmod 0440 /etc/sudoers.d/balanz-legacy-smoke
if bash "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh" \
  "$deploy_root" quiesce "$confirmation" >/dev/null 2>&1; then
  echo "bootstrap accepted legacy sudo authority" >&2
  exit 1
fi
rm -f /etc/sudoers.d/balanz-legacy-smoke
[[ -f $deploy_root/shared/api.env && -f /home/deploy/.ssh/authorized_keys ]]

/usr/bin/sudo -n -u deploy -- /bin/bash -c 'cd /tmp && exec sleep 300' &
rogue_launcher=$!
for _ in $(seq 1 50); do
  pgrep -u "$(id -u deploy)" >/dev/null && break
  sleep 0.05
done
pgrep -u "$(id -u deploy)" >/dev/null

if BALANZ_BOOTSTRAP_SMOKE_FAILPOINT=after-quiesce-purge \
  bash "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh" \
    "$deploy_root" quiesce "$confirmation"; then
  echo "quiesce bootstrap ignored its disposable post-purge failpoint" >&2
  exit 1
fi
wait "$rogue_launcher" 2>/dev/null || true
rogue_launcher=''
assert_dump_processes "$legacy_pm2_dump" "$legacy_pm2_dump_backup" "$legacy_release"
grep -Fqx -- "$home_lure|/home/deploy/.pm2" "$pm2_context_log"
if grep -Fq -- 'export HOME=' "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh"; then
  echo "legacy PM2 bootstrap repurposes HOME" >&2
  exit 1
fi
[[ ! -e $deploy_root/shared/api.env && ! -L $legacy_release/apps/api/.env ]]
[[ ! -e /home/deploy/.ssh/authorized_keys ]]
[[ -f /srv/apps/balanz-deploy/.ssh/authorized_keys ]]
if pgrep -u "$(id -u deploy)" >/dev/null; then
  echo "legacy process survived the post-purge failpoint" >&2
  exit 1
fi
[[ $(getent passwd deploy | cut -d: -f7) == /usr/sbin/nologin ]]
progress=/var/lib/balanz-runtime-isolation/legacy-runtime-quiesce-progress-v1
[[ -f $progress && ! -L $progress && $(stat -c '%U:%G:%a' "$progress") == root:root:400 ]]
[[ ! -e $deploy_root/.legacy-runtime-quiesced-v1 ]]
progress_key_hash=$(sed -n '4p' "$progress")
transferred_key_hash=$(sha256sum /srv/apps/balanz-deploy/.ssh/authorized_keys | cut -d' ' -f1)
[[ $progress_key_hash == "$transferred_key_hash" ]]
pm2_log_hash_before_retry=$(sha256sum "$pm2_log" | cut -d' ' -f1)
cp -- /srv/apps/balanz-deploy/.ssh/authorized_keys "$smoke_root/transferred-authorized-keys"
printf '%s\n' 'ssh-ed25519 tampered-key must-be-rejected' > \
  /srv/apps/balanz-deploy/.ssh/authorized_keys
chown balanz-deploy:balanz-deploy /srv/apps/balanz-deploy/.ssh/authorized_keys
chmod 0600 /srv/apps/balanz-deploy/.ssh/authorized_keys
if bash "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh" \
  "$deploy_root" quiesce "$confirmation" >/dev/null 2>&1; then
  echo "quiesce retry accepted an authorized_keys fingerprint mismatch" >&2
  exit 1
fi
cp -- "$smoke_root/transferred-authorized-keys" \
  /srv/apps/balanz-deploy/.ssh/authorized_keys
chown balanz-deploy:balanz-deploy /srv/apps/balanz-deploy/.ssh/authorized_keys
chmod 0600 /srv/apps/balanz-deploy/.ssh/authorized_keys

bash "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh" \
  "$deploy_root" quiesce "$confirmation"
[[ -f $deploy_root/.legacy-runtime-quiesced-v1 ]]
[[ ! -e $progress && ! -e /var/lib/balanz-runtime-isolation ]]
[[ $(sha256sum "$pm2_log" | cut -d' ' -f1) == "$pm2_log_hash_before_retry" ]]

if bash "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh" \
  "$deploy_root" finalize "$confirmation" >/dev/null 2>&1; then
  echo "bootstrap finalized without server-side credential revocation evidence" >&2
  exit 1
fi
cat >"$deploy_root/.legacy-runtime-credentials-revoked-v1" <<REVOCATION
LEGACY_RUNTIME_CREDENTIALS_REVOKED_V1
$legacy_id
DEV-ROTATION-VALIDATED
REVOCATION
chown root:root "$deploy_root/.legacy-runtime-credentials-revoked-v1"
chmod 0400 "$deploy_root/.legacy-runtime-credentials-revoked-v1"

install -d -m 0700 "$deploy_root/releases/historical"
printf '%s\n' 'must-not-be-widened' >"$deploy_root/releases/historical/.env"
if bash "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh" \
  "$deploy_root" finalize "$confirmation" >/dev/null 2>&1; then
  echo "bootstrap widened a historical credential" >&2
  exit 1
fi
rm -rf -- "$deploy_root/releases/historical"

if BALANZ_BOOTSTRAP_SMOKE_FAILPOINT=after-finalize-pm2 \
  bash "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh" \
    "$deploy_root" finalize "$confirmation"; then
  echo "finalize bootstrap ignored its disposable post-PM2 failpoint" >&2
  exit 1
fi
[[ -d $deploy_root/.pm2 && ! -L $deploy_root/.pm2 ]]
[[ $(stat -c '%U:%G:%a' "$deploy_root/.pm2") == balanz-deploy:balanz-deploy:700 ]]
[[ -z $(find -P "$deploy_root/.pm2" -mindepth 1 -print -quit) ]]
[[ ! -e $deploy_root/.runtime-isolation-bootstrap-v1 &&
    ! -L $deploy_root/.runtime-isolation-bootstrap-v1 ]]
printf '%s\n' 'untrusted partial state' >"$deploy_root/.pm2/rogue"
if bash "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh" \
  "$deploy_root" finalize "$confirmation" >/dev/null 2>&1; then
  echo "finalize retry accepted a non-empty partial PM2 directory" >&2
  exit 1
fi
rm -f -- "$deploy_root/.pm2/rogue"

bash "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh" \
  "$deploy_root" finalize "$confirmation"
[[ $(stat -c '%U:%G:%a' "$deploy_root") == balanz-deploy:balanz-runtime:750 ]]
[[ $(stat -c '%U:%G:%a' "$deploy_root/.runtime-isolation-bootstrap-v1") == root:balanz-runtime:440 ]]
[[ $(grep -Fxc -- 'TimeoutStopSec=135s' /etc/systemd/system/balanz-pm2.service) -eq 1 ]]
expected_is_active_rule='balanz-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl is-active --quiet balanz-pm2.service'
[[ $(grep -Fxc -- "$expected_is_active_rule" /etc/sudoers.d/balanz-runtime-isolation) -eq 1 ]]
[[ $(grep -Ec '^balanz-deploy .*systemctl is-active' /etc/sudoers.d/balanz-runtime-isolation) -eq 1 ]]
grep -Fqx new-enabled "$systemctl_state"
if grep -Fqx legacy-enabled "$systemctl_state"; then
  echo "legacy PM2 service remained enabled after finalize retry" >&2
  exit 1
fi

# A valid finalized sentinel is reentrant before activation and must not alter
# the allowlisted legacy target or recreate any credential-shaped file.
bash "$repo_root/scripts/deploy/bootstrap-runtime-isolation.sh" \
  "$deploy_root" finalize "$confirmation"
[[ $(readlink -f "$deploy_root/current") == "$legacy_release" ]]
[[ ! -e $deploy_root/shared/api.env && ! -L $legacy_release/apps/api/.env ]]

make_candidate() {
  local candidate=$1
  install -d -m 0750 \
    "$candidate/apps/api/dist" \
    "$candidate/apps/web/node_modules/next/dist/bin" \
    "$candidate/scripts/deploy"
  cp -- "$repo_root/ecosystem.config.cjs" "$candidate/ecosystem.config.cjs"
  cp -- \
    "$repo_root/scripts/deploy/activate-release.sh" \
    "$repo_root/scripts/deploy/cleanup-inactive-release-runtime-credentials.sh" \
    "$repo_root/scripts/deploy/hash-release-artifact.cjs" \
    "$repo_root/scripts/deploy/persist-pm2-state.sh" \
    "$repo_root/scripts/deploy/preflight-release-topology.sh" \
    "$repo_root/scripts/deploy/quiesce-legacy-release.sh" \
    "$repo_root/scripts/deploy/run-isolated-runtime.sh" \
    "$repo_root/scripts/deploy/validate-ecosystem.cjs" \
    "$repo_root/scripts/deploy/verify-rollback-api-compatibility.sh" \
    "$candidate/scripts/deploy/"
  printf '%s\n' 'setInterval(() => undefined, 1000);' >"$candidate/apps/api/dist/main.js"
  printf '%s\n' 'setInterval(() => undefined, 1000);' >"$candidate/apps/api/dist/worker.js"
  printf '%s\n' 'setInterval(() => undefined, 1000);' > \
    "$candidate/apps/web/node_modules/next/dist/bin/next"
  chown -R --no-dereference balanz-deploy:balanz-runtime "$candidate"
  find -P "$candidate" -type d -exec chmod 0750 {} +
  find -P "$candidate" -type f -exec chmod 0640 {} +
}

as_deploy() {
  /usr/bin/sudo -n -u balanz-deploy -- \
    /usr/bin/env -i \
    'HOME=/srv/apps/balanz-deploy' \
    "PATH=$fake_bin:/usr/local/bin:/usr/bin:/bin" \
    'BALANZ_DISPOSABLE_CONTAINER=phase0-runtime-isolation-v1' \
    "BALANZ_DEPLOY_SMOKE_PM2=$fake_bin/pm2" \
    "BALANZ_DEPLOY_SMOKE_SYSTEMCTL=$fake_bin/systemctl" \
    "SMOKE_PM2_STATE=$pm2_state" \
    "SMOKE_PM2_PROCESS_RELEASE=$pm2_process_release" \
    "SMOKE_PM2_HOME=$pm2_home" \
    "SMOKE_PM2_LOG=$pm2_log" \
    "SMOKE_PM2_CONTEXT_LOG=$pm2_context_log" \
    "SMOKE_SYSTEMCTL_STATE=$systemctl_state" \
    "SMOKE_SYSTEMCTL_LOG=$systemctl_log" \
    "SMOKE_PM2_DAEMON_STATE=$pm2_daemon_state" \
    "SMOKE_CURL_MODE=${SMOKE_CURL_MODE:-success}" \
    "$@"
}

run_candidate_preparation() {
  local candidate=$1
  as_deploy bash "$candidate/scripts/deploy/preflight-release-topology.sh" \
    "$candidate" "$deploy_root"
  as_deploy bash "$candidate/scripts/deploy/quiesce-legacy-release.sh" \
    "$candidate" "$deploy_root"
  as_deploy bash "$repo_root/scripts/deploy/prepare-runtime-isolation.sh" \
    "$candidate" "$deploy_root"
  printf '%s\n' 'API_ONLY=cutover' | as_deploy bash \
    "$repo_root/scripts/deploy/write-secret-file.sh" "$candidate" "$deploy_root" api
  printf '%s\n' 'WORKER_ONLY=cutover' | as_deploy bash \
    "$repo_root/scripts/deploy/write-secret-file.sh" "$candidate" "$deploy_root" worker
  as_deploy bash "$candidate/scripts/deploy/verify-rollback-api-compatibility.sh" \
    "$candidate" "$deploy_root"
}

candidate_one="$deploy_root/releases/candidate-one"
make_candidate "$candidate_one"
run_candidate_preparation "$candidate_one"
printf '%s\n' \
  '[{"name":"balanz-web-dev"},{"name":"balanz-api-dev"},{"name":"balanz-worker-dev"}]' > \
  "$pm2_dump"
cp -- "$pm2_dump" "$pm2_dump_backup"
chmod 0600 -- "$pm2_dump" "$pm2_dump_backup"
export SMOKE_CURL_MODE=fail-current
if as_deploy bash "$candidate_one/scripts/deploy/activate-release.sh" \
  "$candidate_one" "$deploy_root"; then
  echo "initial cutover unexpectedly passed a failed readiness probe" >&2
  exit 1
fi
[[ $(readlink -f "$deploy_root/current") == "$candidate_one" ]]
[[ ! -s $pm2_state ]]
if grep -Fqx new-active "$systemctl_state"; then
  echo "failed legacy cutover left the new PM2 unit active" >&2
  exit 1
fi
[[ $(cat -- "$pm2_daemon_state") == stopped ]]
[[ ! -e $pm2_pid && ! -L $pm2_pid ]]
assert_dump_processes "$pm2_dump" "$pm2_dump_backup" "$candidate_one"
[[ $(tail -n 1 -- "$pm2_log") =~ ^kill[[:space:]]*$ ]]
grep -Fqx -- 'stop balanz-pm2.service' "$systemctl_log"
printf '%s\n' '{corrupt-primary' >"$pm2_dump"
"$fake_bin/systemctl" restart balanz-pm2.service
[[ ! -s $pm2_state ]]
"$fake_bin/systemctl" stop balanz-pm2.service
[[ $(cat -- "$pm2_daemon_state") == stopped ]]
[[ ! -e $pm2_pid && ! -L $pm2_pid ]]
rm -f -- "$pm2_dump"
"$fake_bin/systemctl" restart balanz-pm2.service
[[ ! -s $pm2_state ]]
"$fake_bin/systemctl" stop balanz-pm2.service
[[ $(cat -- "$pm2_daemon_state") == stopped ]]
[[ ! -e $pm2_pid && ! -L $pm2_pid ]]
export SMOKE_CURL_MODE=success
as_deploy bash "$candidate_one/scripts/deploy/activate-release.sh" \
  "$candidate_one" "$deploy_root"
[[ $(readlink -f "$deploy_root/current") == "$candidate_one" ]]
for name in balanz-web-dev balanz-api-dev balanz-worker-dev; do
  grep -Fqx "$name" "$pm2_state"
done
grep -Fqx new-active "$systemctl_state"
[[ $(cat -- "$pm2_daemon_state") == running ]]
[[ -f $pm2_pid && ! -L $pm2_pid ]]
assert_dump_processes \
  "$pm2_dump" \
  "$pm2_dump_backup" \
  "$candidate_one" \
  balanz-api-dev \
  balanz-web-dev \
  balanz-worker-dev

printf '%s\n' 'legacy cutover smoke passed: exact allowlist, privilege rejection, full UID quiescence, revocation gate, fail-closed retry and isolated activation'
