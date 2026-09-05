#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 || $1 != /* || $2 != /* ]]; then
  echo "usage: preflight-release-topology.sh /absolute/release /absolute/deploy-root" >&2
  exit 64
fi

release_dir=$(realpath -e -- "$1")
deploy_root=$(realpath -e -- "$2")
releases_root=$(realpath -e -- "$deploy_root/releases")
current_link="$deploy_root/current"
deploy_user=$(id -un)
legacy_cutover_marker="$release_dir/.legacy-cutover-required"
legacy_bootstrap_marker="$deploy_root/.runtime-isolation-bootstrap-v1"
legacy_release_id=e3d4f432dca1df6bbd0877d86e60bd52d8c15325
legacy_ecosystem_sha256=5cfc0f281b9bed7c8d98f3f930cb83b6ef24b4640f88dff961b91023a807b2f9
pm2_home="$deploy_root/.pm2"

fail() {
  echo "$1" >&2
  exit "${2:-77}"
}

[[ $deploy_user == balanz-deploy ]] ||
  fail 'release deployment must run as the dedicated balanz-deploy identity' 77
[[ -d $pm2_home && ! -L $pm2_home &&
    $(stat -c '%U:%G:%a' -- "$pm2_home") == "$deploy_user:$deploy_user:700" ]] ||
  fail 'PM2 control directory is missing or unsafe' 74

for command_name in awk cmp cp cut getent grep id mktemp mv passwd realpath sha256sum \
  sort stat sync tr; do
  command -v "$command_name" >/dev/null || fail "$command_name is required for runtime isolation" 69
done
for executable in /usr/bin/env /usr/bin/id /usr/bin/passwd /usr/bin/sudo /usr/local/bin/bun /usr/local/bin/node; do
  [[ -x $executable && ! -L $executable ]] || fail "required system runtime is absent or symbolic: $executable" 69
done
for artifact in \
  "$release_dir/scripts/deploy/run-isolated-runtime.sh" \
  "$release_dir/scripts/deploy/quiesce-legacy-release.sh" \
  "$release_dir/scripts/deploy/persist-pm2-state.sh" \
  "$release_dir/scripts/deploy/hash-release-artifact.cjs"; do
  [[ -f $artifact && ! -L $artifact ]] || fail "release isolation artifact is missing" 72
done

runtime_users=(balanz-web balanz-api balanz-worker balanz-migrator)
declare -A seen_uids=()
seen_uids[$(id -u "$deploy_user")]=$deploy_user
for runtime_user in "${runtime_users[@]}"; do
  getent passwd "$runtime_user" >/dev/null || fail "required runtime user is absent: $runtime_user"
  runtime_uid=$(id -u "$runtime_user")
  [[ $runtime_uid -ne 0 && -z ${seen_uids[$runtime_uid]:-} ]] ||
    fail "runtime users must be non-root and have distinct UIDs"
  seen_uids[$runtime_uid]=$runtime_user
  runtime_password_status=$(/usr/bin/sudo -n -u "$runtime_user" -- /usr/bin/passwd -S | awk '{print $2}') ||
    fail "runtime password state cannot be verified: $runtime_user"
  [[ $(getent passwd "$runtime_user" | cut -d: -f7) == /usr/sbin/nologin &&
      $runtime_password_status == L ]] ||
    fail "runtime identity must have a locked password and nologin shell: $runtime_user"
done

assert_exact_user_groups() {
  local user=$1
  shift
  local expected actual
  expected=$(printf '%s\n' "$@" | LC_ALL=C sort)
  actual=$(id -nG "$user" | tr ' ' '\n' | LC_ALL=C sort)
  [[ $actual == "$expected" ]] || fail "$user has an unexpected group membership"
}

assert_exact_user_groups balanz-web balanz-runtime balanz-web
assert_exact_user_groups balanz-api balanz-api balanz-api-config balanz-runtime
assert_exact_user_groups balanz-worker balanz-runtime balanz-worker balanz-worker-config
assert_exact_user_groups balanz-migrator balanz-migrator balanz-migrator-config balanz-runtime
assert_exact_user_groups balanz-deploy \
  balanz-api-config balanz-deploy balanz-migrator-config balanz-runtime balanz-worker-config

group_members() {
  local group=$1 user
  while IFS=: read -r user _; do
    if id -nG "$user" 2>/dev/null | tr ' ' '\n' | grep -Fxq "$group"; then
      printf '%s\n' "$user"
    fi
  done < <(getent passwd)
}

assert_exact_group() {
  local group=$1
  shift
  local expected actual
  getent group "$group" >/dev/null || fail "required runtime group is absent: $group"
  expected=$(printf '%s\n' "$@" | LC_ALL=C sort)
  actual=$(group_members "$group" | LC_ALL=C sort)
  [[ $actual == "$expected" ]] || fail "$group has unexpected members"
}

assert_exact_group balanz-runtime \
  "$deploy_user" balanz-api balanz-migrator balanz-web balanz-worker
assert_exact_group balanz-api-config "$deploy_user" balanz-api
assert_exact_group balanz-worker-config "$deploy_user" balanz-worker
assert_exact_group balanz-migrator-config "$deploy_user" balanz-migrator

for runtime_user in "${runtime_users[@]}"; do
  expected_uid=$(id -u "$runtime_user")
  actual_uid=$(/usr/bin/sudo -n -u "$runtime_user" -- \
    /usr/bin/env -i 'PATH=/usr/bin:/bin' /usr/bin/id -u) ||
    fail "deployment identity cannot enter isolated runtime $runtime_user"
  [[ $actual_uid == "$expected_uid" ]] || fail "sudo selected an unexpected runtime UID"
  sudo_listing_status=0
  sudo_listing=$(/usr/bin/sudo -n -u "$runtime_user" -- \
    /usr/bin/env -i 'PATH=/usr/bin:/bin' 'LC_ALL=C' \
    sudo -n -l 2>&1) || sudo_listing_status=$?
  if [[ $sudo_listing_status -ne 1 ||
        ( $sudo_listing != *'is not allowed to run sudo on'* &&
          $sudo_listing != *'a password is required'* ) ]]; then
    fail "$runtime_user sudo authority could not be rejected conclusively"
  fi
done

node_version=$(/usr/bin/sudo -n -u balanz-api -- \
  /usr/bin/env -i 'PATH=/usr/local/bin:/usr/bin:/bin' \
  /usr/local/bin/node -p 'process.versions.node') ||
  fail 'isolated API user cannot execute the system Node.js runtime' 69
[[ $node_version == 22.22.0 ]] ||
  fail 'isolated runtime requires the validated system Node.js 22.22.0' 69
/usr/bin/sudo -n -u balanz-worker -- \
  /usr/bin/env -i 'PATH=/usr/local/bin:/usr/bin:/bin' /usr/local/bin/node --version >/dev/null ||
  fail 'isolated worker user cannot execute the system Node.js runtime' 69
/usr/bin/sudo -n -u balanz-web -- \
  /usr/bin/env -i 'PATH=/usr/local/bin:/usr/bin:/bin' /usr/local/bin/node --version >/dev/null ||
  fail 'isolated web user cannot execute the system Node.js runtime' 69
[[ $(/usr/bin/sudo -n -u balanz-migrator -- \
  /usr/bin/env -i 'PATH=/usr/local/bin:/usr/bin:/bin' \
  /usr/local/bin/bun --version) == 1.3.2 ]] ||
  fail 'isolated migrator requires system Bun 1.3.2' 69

if [[ $(dirname -- "$release_dir") != "$releases_root" ]]; then
  echo "release must be a direct child of the deployment releases directory" >&2
  exit 72
fi

if [[ -L $current_link ]]; then
  previous_release=$(readlink -f -- "$current_link")
  if [[ ! -d $previous_release || $(dirname -- "$previous_release") != "$releases_root" ]]; then
    echo "current release link has no valid target" >&2
    exit 72
  fi
  if [[ $previous_release == "$release_dir" ]]; then
    echo "candidate release is already active" >&2
    exit 72
  fi
  previous_id=$(basename -- "$previous_release")
  if [[ $previous_id == "$legacy_release_id" ]]; then
    [[ -f $legacy_bootstrap_marker && ! -L $legacy_bootstrap_marker &&
        $(stat -c '%U:%G:%a' -- "$legacy_bootstrap_marker") == 'root:balanz-runtime:440' ]] ||
      fail 'root-owned legacy isolation bootstrap evidence is absent' 77
    mapfile -t bootstrap_lines <"$legacy_bootstrap_marker"
    [[ ${#bootstrap_lines[@]} -eq 3 &&
        ${bootstrap_lines[0]} == RUNTIME_ISOLATION_BOOTSTRAP_V1 &&
        ${bootstrap_lines[1]} == "$legacy_release_id" &&
        ${bootstrap_lines[2]} == "$legacy_ecosystem_sha256" ]] ||
      fail 'legacy isolation bootstrap evidence is invalid' 77
    legacy_ecosystem="$previous_release/ecosystem.config.cjs"
    [[ -f $legacy_ecosystem && ! -L $legacy_ecosystem ]] ||
      fail 'allowlisted legacy release has no regular ecosystem file' 72
    actual_legacy_hash=$(sha256sum -- "$legacy_ecosystem")
    actual_legacy_hash=${actual_legacy_hash%% *}
    [[ $actual_legacy_hash == "$legacy_ecosystem_sha256" ]] ||
      fail 'allowlisted legacy ecosystem differs from the audited artifact' 72
    [[ ! -e $legacy_cutover_marker && ! -L $legacy_cutover_marker ]] ||
      fail 'candidate contains an unexpected legacy-cutover marker' 72
    umask 077
    printf '%s\n%s\n%s\n%s\n' \
      LEGACY_CUTOVER_V1 \
      "$previous_release" \
      "$legacy_release_id" \
      "$legacy_ecosystem_sha256" >"$legacy_cutover_marker"
    chmod 0600 -- "$legacy_cutover_marker"
  else
    /usr/local/bin/node "$release_dir/scripts/deploy/validate-ecosystem.cjs" \
      "$previous_release/ecosystem.config.cjs" \
      "$previous_release/apps/api" \
      rollback-api
    for profile in web api worker; do
      bash "$previous_release/scripts/deploy/run-isolated-runtime.sh" "$profile" --check >/dev/null
    done
  fi
elif [[ -e $current_link ]]; then
  echo "current release path must be a symbolic link" >&2
  exit 72
fi

for transient_name in current.next current.rollback; do
  transient_path="$deploy_root/$transient_name"
  if [[ ( -e $transient_path || -L $transient_path ) && ! -L $transient_path ]]; then
    echo "$transient_name must be absent or a symbolic link" >&2
    exit 72
  fi
done
