#!/usr/bin/env bash
set -Eeuo pipefail

legacy_release_id=e3d4f432dca1df6bbd0877d86e60bd52d8c15325
legacy_ecosystem_sha256=5cfc0f281b9bed7c8d98f3f930cb83b6ef24b4640f88dff961b91023a807b2f9
confirmation="--acknowledge-legacy-cutover=$legacy_release_id"

if [[ $# -ne 3 || $1 != /srv/apps/balanz || ! $2 =~ ^(quiesce|finalize)$ ||
      $3 != "$confirmation" || $(id -u) -ne 0 ]]; then
  echo "usage (root only): bootstrap-runtime-isolation.sh /srv/apps/balanz quiesce|finalize $confirmation" >&2
  exit 64
fi

deploy_root=$(realpath -e -- "$1")
mode=$2
releases_root=$(realpath -e -- "$deploy_root/releases")
current_link="$deploy_root/current"
legacy_user=deploy
control_user=balanz-deploy
control_home=/srv/apps/balanz-deploy
quiesced_sentinel="$deploy_root/.legacy-runtime-quiesced-v1"
quiesce_progress_root=/var/lib/balanz-runtime-isolation
quiesce_progress="$quiesce_progress_root/legacy-runtime-quiesce-progress-v1"
revocation_attestation="$deploy_root/.legacy-runtime-credentials-revoked-v1"
bootstrap_sentinel="$deploy_root/.runtime-isolation-bootstrap-v1"
sudoers_target=/etc/sudoers.d/balanz-runtime-isolation
pm2_unit=/etc/systemd/system/balanz-pm2.service
temporary=''

fail() {
  echo "$1" >&2
  exit "${2:-77}"
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

for command_name in awk chgrp chmod chown cut find getent gpasswd grep groupadd id \
  install mktemp mv passwd pgrep pkill readlink realpath rm runuser seq sha256sum \
  rmdir sleep ss stat sync tr useradd usermod visudo wc; do
  command -v "$command_name" >/dev/null || fail "$command_name is required for host bootstrap" 69
done
[[ -x /usr/bin/sudo && ! -L /usr/bin/sudo ]] || fail 'a regular system sudo binary is required' 69
if [[ ${BALANZ_DISPOSABLE_CONTAINER:-} == phase0-runtime-isolation-v1 &&
      -f /.dockerenv && -x ${BALANZ_DEPLOY_SMOKE_SYSTEMCTL:-} ]]; then
  systemctl_control() { "$BALANZ_DEPLOY_SMOKE_SYSTEMCTL" "$@"; }
else
  [[ -x /usr/bin/systemctl && ! -L /usr/bin/systemctl ]] ||
    fail 'a regular systemd control binary is required' 69
  systemctl_control() { /usr/bin/systemctl "$@"; }
fi
[[ -x /usr/local/bin/node && ! -L /usr/local/bin/node &&
    $(/usr/local/bin/node -p 'process.versions.node') == 22.22.0 ]] ||
  fail 'the validated system Node.js 22.22.0 runtime is required' 69
[[ -x /usr/local/bin/bun && ! -L /usr/local/bin/bun &&
    $(/usr/local/bin/bun --version) == 1.3.2 ]] ||
  fail 'the validated system Bun 1.3.2 runtime is required' 69
getent passwd "$legacy_user" >/dev/null || fail 'legacy deploy identity is absent' 72
[[ $(id -gn "$legacy_user") == "$legacy_user" ]] ||
  fail 'legacy deploy identity has a non-allowlisted primary group' 77
[[ $(id -nG "$legacy_user") == "$legacy_user" ]] ||
  fail 'legacy deploy identity retains supplementary groups; revoke them before cutover' 77
[[ ! -e $deploy_root/runtime-config && ! -L $deploy_root/runtime-config ]] ||
  fail 'bootstrap only accepts a clean legacy topology without runtime-config' 72

[[ -L $current_link ]] || fail 'current must identify the audited legacy release' 72
previous_release=$(readlink -f -- "$current_link")
[[ -d $previous_release && $(dirname -- "$previous_release") == "$releases_root" &&
    $(basename -- "$previous_release") == "$legacy_release_id" ]] ||
  fail 'current is not the allowlisted legacy release' 72
legacy_ecosystem="$previous_release/ecosystem.config.cjs"
[[ -f $legacy_ecosystem && ! -L $legacy_ecosystem ]] ||
  fail 'allowlisted legacy ecosystem is missing or unsafe' 72
actual_legacy_hash=$(sha256sum -- "$legacy_ecosystem")
actual_legacy_hash=${actual_legacy_hash%% *}
[[ $actual_legacy_hash == "$legacy_ecosystem_sha256" ]] ||
  fail 'allowlisted legacy ecosystem differs from the audited artifact' 72

assert_sentinel() {
  local path=$1 kind=$2
  local -a lines=()
  [[ -f $path && ! -L $path && $(stat -c '%U:%G:%a' -- "$path") == root:root:400 ]] ||
    fail "$kind evidence is absent or unsafe" 77
  mapfile -t lines <"$path"
  [[ ${#lines[@]} -eq 3 && ${lines[1]} == "$legacy_release_id" ]] ||
    fail "$kind evidence has invalid content" 77
  if [[ $kind == quiescence ]]; then
    [[ ${lines[0]} == LEGACY_RUNTIME_QUIESCED_V1 &&
        ${lines[2]} == "$legacy_ecosystem_sha256" ]] ||
      fail 'quiescence evidence has invalid content' 77
  else
    [[ ${lines[0]} == LEGACY_RUNTIME_CREDENTIALS_REVOKED_V1 &&
        ${lines[2]} =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$ ]] ||
      fail 'revocation evidence has invalid content' 77
  fi
}

assert_bootstrap_sentinel() {
  local -a lines=()
  [[ -f $bootstrap_sentinel && ! -L $bootstrap_sentinel &&
      $(stat -c '%U:%G:%a' -- "$bootstrap_sentinel") == root:balanz-runtime:440 ]] ||
    fail 'runtime isolation bootstrap evidence is absent or unsafe' 77
  mapfile -t lines <"$bootstrap_sentinel"
  [[ ${#lines[@]} -eq 3 &&
      ${lines[0]} == RUNTIME_ISOLATION_BOOTSTRAP_V1 &&
      ${lines[1]} == "$legacy_release_id" &&
      ${lines[2]} == "$legacy_ecosystem_sha256" ]] ||
    fail 'runtime isolation bootstrap evidence has invalid content' 77
}

authorized_keys_sha256=''
assert_quiesce_progress() {
  local -a lines=()
  [[ -d $quiesce_progress_root && ! -L $quiesce_progress_root &&
      $(stat -c '%U:%G:%a' -- "$quiesce_progress_root") == root:root:700 &&
      -f $quiesce_progress && ! -L $quiesce_progress &&
      $(stat -c '%U:%G:%a' -- "$quiesce_progress") == root:root:400 ]] ||
    fail 'legacy quiesce progress evidence is absent or unsafe' 77
  mapfile -t lines <"$quiesce_progress"
  [[ ${#lines[@]} -eq 4 &&
      ${lines[0]} == LEGACY_RUNTIME_QUIESCE_PROGRESS_V1 &&
      ${lines[1]} == "$legacy_release_id" &&
      ${lines[2]} == "$legacy_ecosystem_sha256" &&
      ${lines[3]} =~ ^[[:xdigit:]]{64}$ ]] ||
    fail 'legacy quiesce progress evidence has invalid content' 77
  authorized_keys_sha256=${lines[3]}
}

maybe_smoke_failpoint() {
  local point=$1
  if [[ ${BALANZ_DISPOSABLE_CONTAINER:-} == phase0-runtime-isolation-v1 &&
        -f /.dockerenv && ${BALANZ_BOOTSTRAP_SMOKE_FAILPOINT:-} == "$point" ]]; then
    echo "disposable bootstrap failpoint reached: $point" >&2
    exit 86
  fi
}

assert_legacy_identity_inert() {
  local legacy_uid process_path process_uid sudo_status=0 sudo_listing passwd_status
  legacy_uid=$(id -u "$legacy_user")
  [[ $(getent passwd "$legacy_user" | cut -d: -f7) == /usr/sbin/nologin ]] ||
    fail 'legacy deployment login shell remains enabled'
  passwd_status=$(passwd -S "$legacy_user" | awk '{print $2}')
  [[ $passwd_status == L ]] || fail 'legacy deployment password is not locked'
  [[ $(id -nG "$legacy_user" | tr ' ' '\n' | wc -l) -eq 1 ]] ||
    fail 'legacy deployment identity retains supplementary groups'
  for process_path in /proc/[0-9]*; do
    process_uid=$(stat -c '%u' -- "$process_path" 2>/dev/null) || continue
    [[ $process_uid != "$legacy_uid" ]] || fail 'a legacy deployment process remains alive'
  done
  sudo_listing=$(LC_ALL=C /usr/bin/sudo -n -U "$legacy_user" -l 2>&1) || sudo_status=$?
  [[ $sudo_status -le 1 && $sudo_listing == *'is not allowed to run sudo on'* ]] ||
    fail 'legacy deployment identity retains sudo authority'
  for socket_path in /var/run/docker.sock /run/docker.sock /run/containerd/containerd.sock \
    /run/podman/podman.sock /var/run/lxd/unix.socket; do
    if [[ -e $socket_path || -L $socket_path ]]; then
      ! runuser -u "$legacy_user" -- test -r "$socket_path" ||
        fail 'legacy deployment identity retains access to a privileged daemon socket'
    fi
  done
}

legacy_identity_is_inert() {
  local legacy_uid process_path process_uid sudo_status=0 sudo_listing passwd_status
  legacy_uid=$(id -u "$legacy_user") || return 1
  [[ $(getent passwd "$legacy_user" | cut -d: -f7) == /usr/sbin/nologin ]] || return 1
  passwd_status=$(passwd -S "$legacy_user" | awk '{print $2}') || return 1
  [[ $passwd_status == L ]] || return 1
  [[ $(id -nG "$legacy_user" | tr ' ' '\n' | wc -l) -eq 1 ]] || return 1
  for process_path in /proc/[0-9]*; do
    process_uid=$(stat -c '%u' -- "$process_path" 2>/dev/null) || continue
    [[ $process_uid != "$legacy_uid" ]] || return 1
  done
  sudo_listing=$(LC_ALL=C /usr/bin/sudo -n -U "$legacy_user" -l 2>&1) || sudo_status=$?
  [[ $sudo_status -le 1 && $sudo_listing == *'is not allowed to run sudo on'* ]] || return 1
  for socket_path in /var/run/docker.sock /run/docker.sock /run/containerd/containerd.sock \
    /run/podman/podman.sock /var/run/lxd/unix.socket; do
    if [[ -e $socket_path || -L $socket_path ]]; then
      ! runuser -u "$legacy_user" -- test -r "$socket_path" || return 1
    fi
  done
}

legacy_ports_are_absent() {
  local port
  for port in 5181 3021 3002; do
    ! ss -H -ltn "sport = :$port" | grep -q . || return 1
  done
}

legacy_credentials_are_absent() {
  [[ ! -e $legacy_env_link && ! -L $legacy_env_link &&
      ! -e $shared_env && ! -L $shared_env ]]
}

if [[ $mode == quiesce ]]; then
  legacy_home=$(getent passwd "$legacy_user" | cut -d: -f6)
  legacy_authorized_keys="$legacy_home/.ssh/authorized_keys"
  control_authorized_keys="$control_home/.ssh/authorized_keys"
  legacy_env_link="$previous_release/apps/api/.env"
  shared_env="$deploy_root/shared/api.env"

  if [[ -e $quiesced_sentinel || -L $quiesced_sentinel ]]; then
    assert_sentinel "$quiesced_sentinel" quiescence
    assert_legacy_identity_inert
    legacy_ports_are_absent || fail 'a legacy application port remains bound'
    legacy_credentials_are_absent || fail 'legacy runtime credentials reappeared' 74
    [[ -f $control_authorized_keys && ! -L $control_authorized_keys &&
        $(stat -c '%U:%G:%a' -- "$control_authorized_keys") == "$control_user:$control_user:600" ]] ||
      fail 'transferred deployment authorized_keys is absent or unsafe' 74
    if [[ -e $quiesce_progress || -L $quiesce_progress ]]; then
      assert_quiesce_progress
      actual_authorized_keys_sha256=$(sha256sum -- "$control_authorized_keys")
      actual_authorized_keys_sha256=${actual_authorized_keys_sha256%% *}
      [[ $actual_authorized_keys_sha256 == "$authorized_keys_sha256" ]] ||
        fail 'transferred deployment authorized_keys differs from progress evidence' 74
      rm -f -- "$quiesce_progress"
    fi
    if [[ -e $quiesce_progress_root || -L $quiesce_progress_root ]]; then
      [[ -d $quiesce_progress_root && ! -L $quiesce_progress_root &&
          $(stat -c '%U:%G:%a' -- "$quiesce_progress_root") == root:root:700 ]] ||
        fail 'legacy quiesce progress directory is unsafe' 77
      rmdir -- "$quiesce_progress_root" ||
        fail 'legacy quiesce progress directory is not empty' 74
    fi
    if [[ -e $bootstrap_sentinel || -L $bootstrap_sentinel ]]; then
      assert_bootstrap_sentinel
    fi
    printf '%s\n' 'legacy runtime is already quiesced'
    trap - EXIT HUP INT TERM
    exit 0
  fi

  [[ ! -e $bootstrap_sentinel && ! -L $bootstrap_sentinel ]] ||
    fail 'runtime isolation bootstrap is already finalized' 72
  [[ ! -e $deploy_root/.pm2 && ! -L $deploy_root/.pm2 ]] ||
    fail 'quiesce only accepts a clean legacy topology without a new PM2 home' 72
  legacy_sudo_listing=$(LC_ALL=C /usr/bin/sudo -n -U "$legacy_user" -l 2>&1) || true
  [[ $legacy_sudo_listing == *'is not allowed to run sudo on'* ]] ||
    fail 'legacy deploy identity has sudo authority; revoke it before cutover'
  for socket_path in /var/run/docker.sock /run/docker.sock /run/containerd/containerd.sock \
    /run/podman/podman.sock /var/run/lxd/unix.socket; do
    if [[ -e $socket_path || -L $socket_path ]]; then
      ! runuser -u "$legacy_user" -- test -r "$socket_path" ||
        fail 'legacy deploy identity can access a privileged daemon socket'
    fi
  done

  if [[ -e $legacy_env_link || -L $legacy_env_link ]]; then
    [[ -L $legacy_env_link && $(readlink -- "$legacy_env_link") == "$shared_env" ]] ||
      fail 'legacy API environment link differs from the audited topology' 72
  fi
  if [[ -e $shared_env || -L $shared_env ]]; then
    [[ -f $shared_env && ! -L $shared_env &&
        $(stat -c '%U:%a' -- "$shared_env") == "$legacy_user:600" ]] ||
      fail 'legacy shared API environment file is unsafe' 72
  fi

  if [[ -e $quiesce_progress || -L $quiesce_progress ]]; then
    assert_quiesce_progress
  else
    [[ -f $legacy_authorized_keys && ! -L $legacy_authorized_keys ]] ||
      fail 'legacy deployment authorized_keys is unavailable for controlled transfer' 72
    authorized_keys_sha256=$(sha256sum -- "$legacy_authorized_keys")
    authorized_keys_sha256=${authorized_keys_sha256%% *}
    [[ $authorized_keys_sha256 =~ ^[[:xdigit:]]{64}$ ]] ||
      fail 'legacy deployment authorized_keys could not be fingerprinted' 74
    if [[ -e $quiesce_progress_root || -L $quiesce_progress_root ]]; then
      [[ -d $quiesce_progress_root && ! -L $quiesce_progress_root &&
          $(stat -c '%U:%G:%a' -- "$quiesce_progress_root") == root:root:700 ]] ||
        fail 'legacy quiesce progress directory is unsafe' 77
      [[ -z $(find -P "$quiesce_progress_root" -mindepth 1 -print -quit) ]] ||
        fail 'legacy quiesce progress directory contains unexpected state' 77
    else
      install -d -m 0700 -o root -g root -- "$quiesce_progress_root"
    fi
    umask 077
    temporary=$(mktemp -- "$quiesce_progress_root/.legacy-runtime-quiesce-progress-v1.XXXXXX")
    printf '%s\n%s\n%s\n%s\n' \
      LEGACY_RUNTIME_QUIESCE_PROGRESS_V1 \
      "$legacy_release_id" \
      "$legacy_ecosystem_sha256" \
      "$authorized_keys_sha256" >"$temporary"
    chown root:root -- "$temporary"
    chmod 0400 -- "$temporary"
    mv -T -- "$temporary" "$quiesce_progress"
    temporary=''
    assert_quiesce_progress
  fi

  if [[ -e $legacy_authorized_keys || -L $legacy_authorized_keys ]]; then
    [[ -f $legacy_authorized_keys && ! -L $legacy_authorized_keys ]] ||
      fail 'legacy deployment authorized_keys became unsafe' 74
    actual_authorized_keys_sha256=$(sha256sum -- "$legacy_authorized_keys")
    actual_authorized_keys_sha256=${actual_authorized_keys_sha256%% *}
    [[ $actual_authorized_keys_sha256 == "$authorized_keys_sha256" ]] ||
      fail 'legacy deployment authorized_keys changed during quiesce' 74
  else
    [[ -f $control_authorized_keys && ! -L $control_authorized_keys &&
        $(stat -c '%U:%G:%a' -- "$control_authorized_keys") == "$control_user:$control_user:600" ]] ||
      fail 'transferred deployment authorized_keys is absent or unsafe' 74
    actual_authorized_keys_sha256=$(sha256sum -- "$control_authorized_keys")
    actual_authorized_keys_sha256=${actual_authorized_keys_sha256%% *}
    [[ $actual_authorized_keys_sha256 == "$authorized_keys_sha256" ]] ||
      fail 'transferred deployment authorized_keys differs from progress evidence' 74
  fi

  resume_after_purge=false
  if [[ ! -e $legacy_authorized_keys && ! -L $legacy_authorized_keys ]] &&
    legacy_identity_is_inert && legacy_ports_are_absent && legacy_credentials_are_absent; then
    resume_after_purge=true
  fi

  if [[ $resume_after_purge != true ]]; then
    for group_name in balanz-runtime balanz-api-config balanz-worker-config balanz-migrator-config; do
      getent group "$group_name" >/dev/null || groupadd --system "$group_name"
    done
    ensure_user() {
      local user=$1 home=$2 shell=$3
      if ! getent passwd "$user" >/dev/null; then
        useradd --system --user-group --create-home --home-dir "$home" --shell "$shell" "$user"
      fi
      [[ $(id -u "$user") -ne 0 && $(getent passwd "$user" | cut -d: -f6) == "$home" &&
          $(getent passwd "$user" | cut -d: -f7) == "$shell" ]] ||
        fail "existing identity $user does not match the required profile"
    }
    ensure_user "$control_user" "$control_home" /bin/bash
    ensure_user balanz-web /var/lib/balanz-web /usr/sbin/nologin
    ensure_user balanz-api /var/lib/balanz-api /usr/sbin/nologin
    ensure_user balanz-worker /var/lib/balanz-worker /usr/sbin/nologin
    ensure_user balanz-migrator /var/lib/balanz-migrator /usr/sbin/nologin

    declare -A uid_owner=()
    for identity in "$legacy_user" "$control_user" balanz-web balanz-api balanz-worker balanz-migrator; do
      identity_uid=$(id -u "$identity")
      [[ -z ${uid_owner[$identity_uid]:-} ]] || fail 'deployment and runtime identities must have distinct UIDs'
      uid_owner[$identity_uid]=$identity
    done

    usermod --groups balanz-runtime,balanz-api-config,balanz-worker-config,balanz-migrator-config \
      "$control_user"
    usermod --groups balanz-runtime balanz-web
    usermod --groups balanz-runtime,balanz-api-config balanz-api
    usermod --groups balanz-runtime,balanz-worker-config balanz-worker
    usermod --groups balanz-runtime,balanz-migrator-config balanz-migrator

    install -d -m 0700 -o "$control_user" -g "$control_user" "$control_home/.ssh"
    if [[ -e $legacy_authorized_keys || -L $legacy_authorized_keys ]]; then
      install -m 0600 -o "$control_user" -g "$control_user" \
        "$legacy_authorized_keys" "$control_authorized_keys"
    fi
    [[ -f $control_authorized_keys && ! -L $control_authorized_keys &&
        $(stat -c '%U:%G:%a' -- "$control_authorized_keys") == "$control_user:$control_user:600" ]] ||
      fail 'transferred deployment authorized_keys is unsafe' 74
    actual_authorized_keys_sha256=$(sha256sum -- "$control_authorized_keys")
    actual_authorized_keys_sha256=${actual_authorized_keys_sha256%% *}
    [[ $actual_authorized_keys_sha256 == "$authorized_keys_sha256" ]] ||
      fail 'transferred deployment authorized_keys failed fingerprint verification' 74

    temporary=$(mktemp /etc/sudoers.d/.balanz-runtime-isolation.XXXXXX)
    cat >"$temporary" <<'SUDOERS'
balanz-deploy ALL=(balanz-web) NOPASSWD: ALL
balanz-deploy ALL=(balanz-api) NOPASSWD: ALL
balanz-deploy ALL=(balanz-worker) NOPASSWD: ALL
balanz-deploy ALL=(balanz-migrator) NOPASSWD: ALL
balanz-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart balanz-pm2.service
balanz-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl stop balanz-pm2.service
balanz-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl is-active --quiet balanz-pm2.service
SUDOERS
    chmod 0440 -- "$temporary"
    chown root:root -- "$temporary"
    visudo -cf "$temporary" >/dev/null || fail 'generated runtime sudo policy is invalid' 74
    mv -T -- "$temporary" "$sudoers_target"
    temporary=''

    [[ -r $legacy_home/.nvm/nvm.sh ]] || fail 'legacy PM2 control environment is unavailable' 69
    [[ -d $legacy_home/.pm2 && ! -L $legacy_home/.pm2 &&
        $(stat -c '%U' -- "$legacy_home/.pm2") == "$legacy_user" ]] ||
      fail 'legacy PM2 home is missing or unsafe' 74
    chmod 0700 -- "$legacy_home/.pm2"
    runuser -u "$legacy_user" -- /bin/bash -s -- "$legacy_home" <<'LEGACY_PM2'
set -Eeuo pipefail
legacy_home=$1
legacy_pm2_home="$legacy_home/.pm2"
export NVM_DIR="$legacy_home/.nvm"
# shellcheck disable=SC1090
source "$NVM_DIR/nvm.sh"
command -v pm2 >/dev/null
legacy_pm2() { PM2_HOME="$legacy_pm2_home" pm2 "$@"; }
dump_target_is_safe() {
  local target=$1
  [[ ! -e $target && ! -L $target ]] ||
    [[ -f $target && ! -L $target &&
       $(stat -c '%U:%h' -- "$target") == "$(id -un):1" ]]
}
for dump_target in "$legacy_pm2_home/dump.pm2" "$legacy_pm2_home/dump.pm2.bak"; do
  dump_target_is_safe "$dump_target"
done
for process_name in balanz-web-dev balanz-api-dev balanz-worker-dev; do
  if legacy_pm2 describe "$process_name" >/dev/null 2>&1; then
    legacy_pm2 delete "$process_name" >/dev/null
  fi
  ! legacy_pm2 describe "$process_name" >/dev/null 2>&1
done
legacy_pm2 save --force >/dev/null
for dump_target in "$legacy_pm2_home/dump.pm2" "$legacy_pm2_home/dump.pm2.bak"; do
  temporary=$(mktemp -- "$legacy_pm2_home/.empty-dump.XXXXXX")
  printf '%s\n' '[]' >"$temporary"
  chmod 0600 -- "$temporary"
  sync -f -- "$temporary"
  mv -Tf -- "$temporary" "$dump_target"
  sync -f -- "$legacy_pm2_home"
  [[ -f $dump_target && ! -L $dump_target &&
      $(stat -c '%U:%a:%h' -- "$dump_target") == "$(id -un):600:1" ]]
done
cmp -s -- "$legacy_pm2_home/dump.pm2" "$legacy_pm2_home/dump.pm2.bak"
node -e '
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(process.argv[1], "utf8")), []);
' "$legacy_pm2_home/dump.pm2"
LEGACY_PM2

    if systemctl_control cat "pm2-$legacy_user.service" >/dev/null 2>&1; then
      systemctl_control disable --now "pm2-$legacy_user.service"
    fi
    ! systemctl_control is-active --quiet "pm2-$legacy_user.service" ||
      fail 'legacy PM2 system service remains active'
    ! systemctl_control is-enabled --quiet "pm2-$legacy_user.service" ||
      fail 'legacy PM2 system service remains enabled'

    legacy_uid=$(id -u "$legacy_user")
    rm -f -- "$legacy_authorized_keys"
    usermod --groups '' --lock --shell /usr/sbin/nologin "$legacy_user"
    pkill -TERM -u "$legacy_uid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      pgrep -u "$legacy_uid" >/dev/null 2>&1 || break
      sleep 0.1
    done
    pkill -KILL -u "$legacy_uid" 2>/dev/null || true

    legacy_ports_are_absent || fail 'a legacy application port remains bound'
    rm -f -- "$legacy_env_link" "$shared_env"
  fi

  legacy_credentials_are_absent || fail 'legacy runtime credentials could not be purged' 74
  assert_legacy_identity_inert
  legacy_ports_are_absent || fail 'a legacy application port remains bound'
  maybe_smoke_failpoint after-quiesce-purge

  umask 077
  temporary=$(mktemp -- "$deploy_root/.legacy-runtime-quiesced-v1.XXXXXX")
  printf '%s\n%s\n%s\n' \
    LEGACY_RUNTIME_QUIESCED_V1 "$legacy_release_id" "$legacy_ecosystem_sha256" >"$temporary"
  chown root:root -- "$temporary"
  chmod 0400 -- "$temporary"
  mv -T -- "$temporary" "$quiesced_sentinel"
  temporary=''
  rm -f -- "$quiesce_progress"
  [[ ! -e $quiesce_progress && ! -L $quiesce_progress ]] ||
    fail 'legacy quiesce progress evidence could not be removed' 74
  rmdir -- "$quiesce_progress_root" ||
    fail 'legacy quiesce progress directory is not empty' 74
  printf '%s\n' 'legacy runtime quiesced; rotate/revoke its PostgreSQL and Vault credentials before finalize'
  trap - EXIT HUP INT TERM
  exit 0
fi

if [[ -e $bootstrap_sentinel || -L $bootstrap_sentinel ]]; then
  assert_bootstrap_sentinel
fi
if [[ -e $deploy_root/.pm2 || -L $deploy_root/.pm2 ]]; then
  [[ -d $deploy_root/.pm2 && ! -L $deploy_root/.pm2 &&
      $(stat -c '%U:%G:%a' -- "$deploy_root/.pm2") == "$control_user:$control_user:700" ]] ||
    fail 'existing PM2 control directory is unsafe' 74
  if [[ ! -e $bootstrap_sentinel && ! -L $bootstrap_sentinel &&
        -n $(find -P "$deploy_root/.pm2" -mindepth 1 -print -quit) ]]; then
    fail 'partial bootstrap PM2 control directory is not empty' 74
  fi
elif [[ -e $bootstrap_sentinel || -L $bootstrap_sentinel ]]; then
  fail 'finalized bootstrap evidence has no PM2 control directory' 74
fi

assert_sentinel "$quiesced_sentinel" quiescence
assert_sentinel "$revocation_attestation" revocation
assert_legacy_identity_inert
[[ ! -e $previous_release/apps/api/.env && ! -L $previous_release/apps/api/.env &&
    ! -e $deploy_root/shared/api.env && ! -L $deploy_root/shared/api.env ]] ||
  fail 'legacy runtime credential files reappeared' 74
if [[ -d $deploy_root/shared ]]; then
  [[ -z $(find -P "$deploy_root/shared" -mindepth 1 -print -quit) ]] ||
    fail 'legacy shared directory is not empty after credential revocation' 74
fi
if find -P "$releases_root" -type f \
  \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' \) \
  -print -quit | grep -q .; then
  fail 'a legacy release still contains a credential-shaped file' 74
fi

for identity in "$control_user" balanz-web balanz-api balanz-worker balanz-migrator; do
  getent passwd "$identity" >/dev/null || fail "required isolated identity is absent: $identity"
done
visudo -cf "$sudoers_target" >/dev/null || fail 'runtime sudo policy is absent or invalid' 74

while IFS= read -r -d '' historical_release; do
  [[ $historical_release == "$previous_release" ]] && continue
  chown root:root -- "$historical_release"
  chmod 0700 -- "$historical_release"
done < <(find -P "$releases_root" -mindepth 1 -maxdepth 1 -type d -print0)
chown "$control_user:balanz-runtime" "$deploy_root" "$releases_root"
chown -h "$control_user:balanz-runtime" "$current_link"
chown -R --no-dereference "$control_user:balanz-runtime" "$previous_release"
chmod 0750 -- "$deploy_root" "$releases_root" "$previous_release"
find -P "$previous_release" -type d -exec chmod 0750 -- {} +
find -P "$previous_release" -type f -perm /0100 -exec chmod 0750 -- {} +
find -P "$previous_release" -type f ! -perm /0100 -exec chmod 0640 -- {} +
if [[ -d $deploy_root/shared ]]; then
  chown "$control_user:balanz-runtime" "$deploy_root/shared"
  chmod 0750 "$deploy_root/shared"
fi
install -d -m 0700 -o "$control_user" -g "$control_user" "$deploy_root/.pm2"
maybe_smoke_failpoint after-finalize-pm2
chown root:root -- "$quiesced_sentinel" "$revocation_attestation"
chmod 0400 -- "$quiesced_sentinel" "$revocation_attestation"

temporary=$(mktemp /etc/systemd/system/.balanz-pm2.service.XXXXXX)
cat >"$temporary" <<'SYSTEMD_UNIT'
[Unit]
Description=Balanz PM2 control plane
After=network.target

[Service]
Type=forking
User=balanz-deploy
Group=balanz-deploy
Environment=PM2_HOME=/srv/apps/balanz/.pm2
Environment=PATH=/usr/local/bin:/usr/bin:/bin
PIDFile=/srv/apps/balanz/.pm2/pm2.pid
ExecStart=/usr/local/bin/node /srv/apps/balanz/current/node_modules/pm2/bin/pm2 resurrect
ExecReload=/usr/local/bin/node /srv/apps/balanz/current/node_modules/pm2/bin/pm2 reload all
ExecStop=/usr/local/bin/node /srv/apps/balanz/current/node_modules/pm2/bin/pm2 kill
TimeoutStopSec=135s
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SYSTEMD_UNIT
chown root:root -- "$temporary"
chmod 0644 -- "$temporary"
mv -T -- "$temporary" "$pm2_unit"
temporary=''
systemctl_control daemon-reload
systemctl_control enable balanz-pm2.service
[[ $(stat -c '%U:%G:%a' -- "$pm2_unit") == root:root:644 ]] ||
  fail 'new PM2 system service ownership is unsafe' 74
systemctl_control is-enabled --quiet balanz-pm2.service ||
  fail 'new PM2 system service is not enabled' 74

umask 077
temporary=$(mktemp -- "$deploy_root/.runtime-isolation-bootstrap-v1.XXXXXX")
printf '%s\n%s\n%s\n' \
  RUNTIME_ISOLATION_BOOTSTRAP_V1 "$legacy_release_id" "$legacy_ecosystem_sha256" >"$temporary"
chown root:balanz-runtime -- "$temporary"
chmod 0440 -- "$temporary"
mv -T -- "$temporary" "$bootstrap_sentinel"
temporary=''

[[ $(stat -c '%U:%G:%a' -- "$deploy_root") == "$control_user:balanz-runtime:750" &&
    $(stat -c '%U:%G:%a' -- "$bootstrap_sentinel") == root:balanz-runtime:440 ]] ||
  fail 'runtime-isolation bootstrap ownership could not be verified' 74
printf '%s\n' 'runtime isolation bootstrap finalized; use only the balanz-deploy SSH identity for releases'
trap - EXIT HUP INT TERM
