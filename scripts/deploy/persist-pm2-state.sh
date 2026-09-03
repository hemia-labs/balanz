#!/usr/bin/env bash

# Source this file after defining the caller-specific pm2() and
# systemctl_control() commands. PM2 7.0.4 reports success when its implicit
# dump.pm2.bak write fails, so callers must never rely on `pm2 save` alone.

_pm2_home_is_safe() {
  [[ $# -eq 1 && $1 == /* && -d $1 && ! -L $1 &&
      $(stat -c '%U:%G:%a' -- "$1") == "$(id -un):$(id -gn):700" ]]
}

_pm2_existing_dump_target_is_safe() {
  local target=$1
  [[ ! -e $target && ! -L $target ]] ||
    [[ -f $target && ! -L $target &&
       $(stat -c '%U:%h' -- "$target") == "$(id -un):1" ]]
}

_pm2_installed_dump_is_safe() {
  local target=$1
  [[ -f $target && ! -L $target &&
      $(stat -c '%U:%a:%h' -- "$target") == "$(id -un):600:1" ]]
}

_pm2_process_json_matches() {
  if [[ $# -lt 2 || $1 != /* || $2 != /* ]]; then
    return 64
  fi
  local json_file=$1 release_dir=$2
  shift 2

  /usr/local/bin/node -e '
    "use strict";
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const [jsonPath, releaseRoot, ...expectedNames] = process.argv.slice(1);
    const profiles = new Map([
      ["balanz-web-dev", "web"],
      ["balanz-api-dev", "api"],
      ["balanz-worker-dev", "worker"],
    ]);
    assert.equal(new Set(expectedNames).size, expectedNames.length);
    for (const name of expectedNames) assert.ok(profiles.has(name));
    const entries = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    assert.ok(Array.isArray(entries));
    const actualNames = [];
    for (const raw of entries) {
      assert.ok(raw && typeof raw === "object" && !Array.isArray(raw));
      const processEnvironment = raw.pm2_env ?? raw;
      assert.ok(processEnvironment && typeof processEnvironment === "object");
      const name = raw.name ?? processEnvironment.name;
      assert.equal(typeof name, "string");
      assert.ok(profiles.has(name));
      assert.equal(processEnvironment.name, name);
      assert.equal(processEnvironment.pm_cwd, releaseRoot);
      assert.equal(
        processEnvironment.pm_exec_path,
        path.join(releaseRoot, "scripts/deploy/run-isolated-runtime.sh"),
      );
      assert.equal(processEnvironment.exec_interpreter, "/bin/bash");
      const args = Array.isArray(processEnvironment.args)
        ? processEnvironment.args
        : typeof processEnvironment.args === "string"
          ? [processEnvironment.args]
          : [];
      assert.deepStrictEqual(args, [profiles.get(name)]);
      actualNames.push(name);
    }
    assert.equal(new Set(actualNames).size, actualNames.length);
    assert.deepStrictEqual(actualNames.sort(), [...expectedNames].sort());
  ' "$json_file" "$release_dir" "$@"
}

_pm2_empty_json_array() {
  [[ $# -eq 1 && $1 == /* ]] || return 64
  /usr/local/bin/node -e '
    "use strict";
    const fs = require("node:fs");
    try {
      const entries = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (!Array.isArray(entries)) process.exit(74);
      process.exit(entries.length === 0 ? 0 : 1);
    } catch {
      process.exit(74);
    }
  ' "$1"
}

_pm2_atomic_copy() {
  if [[ $# -ne 3 || $1 != /* || $2 != /* || $3 != /* ]]; then
    return 64
  fi
  local source=$1 target=$2 pm2_home=$3 temporary=''
  _pm2_home_is_safe "$pm2_home" || return 74
  [[ -f $source && ! -L $source && $(stat -c '%U:%h' -- "$source") == "$(id -un):1" ]] ||
    return 74
  _pm2_existing_dump_target_is_safe "$target" || return 74
  temporary=$(mktemp -- "$pm2_home/.validated-dump.XXXXXX") || return 74
  if ! cp -- "$source" "$temporary" ||
     ! chmod 0600 -- "$temporary" ||
     ! sync -f -- "$temporary" ||
     ! mv -Tf -- "$temporary" "$target" ||
     ! sync -f -- "$pm2_home"; then
    rm -f -- "$temporary"
    return 74
  fi
  _pm2_installed_dump_is_safe "$target"
}

_pm2_atomic_write_empty() {
  if [[ $# -ne 2 || $1 != /* || $2 != /* ]]; then
    return 64
  fi
  local target=$1 pm2_home=$2 temporary=''
  _pm2_home_is_safe "$pm2_home" || return 74
  _pm2_existing_dump_target_is_safe "$target" || return 74
  temporary=$(mktemp -- "$pm2_home/.empty-dump.XXXXXX") || return 74
  if ! printf '%s\n' '[]' >"$temporary" ||
     ! chmod 0600 -- "$temporary" ||
     ! sync -f -- "$temporary" ||
     ! mv -Tf -- "$temporary" "$target" ||
     ! sync -f -- "$pm2_home"; then
    rm -f -- "$temporary"
    return 74
  fi
  _pm2_installed_dump_is_safe "$target"
}

pm2_live_processes_match() {
  if [[ $# -lt 1 || $1 != /* ]]; then
    return 64
  fi
  local release_dir=$1 snapshot=''
  shift
  [[ -d $release_dir && ! -L $release_dir &&
      $(realpath -e -- "$release_dir") == "$release_dir" ]] || return 74
  snapshot=$(mktemp) || return 74
  if ! PM2_SILENT=true pm2 jlist >"$snapshot" ||
     ! _pm2_process_json_matches "$snapshot" "$release_dir" "$@"; then
    rm -f -- "$snapshot"
    return 75
  fi
  rm -f -- "$snapshot"
}

pm2_live_processes_are_empty() {
  local snapshot='' validation_status=0
  snapshot=$(mktemp) || return 74
  if ! PM2_SILENT=true pm2 jlist >"$snapshot"; then
    rm -f -- "$snapshot"
    return 75
  fi
  _pm2_empty_json_array "$snapshot" || validation_status=$?
  rm -f -- "$snapshot"
  return "$validation_status"
}

persist_pm2_dumps_match() {
  if [[ $# -lt 2 || $1 != /* || $2 != /* ]]; then
    return 64
  fi
  local pm2_home=$1 release_dir=$2 primary backup
  shift 2
  primary="$pm2_home/dump.pm2"
  backup="$pm2_home/dump.pm2.bak"
  _pm2_home_is_safe "$pm2_home" || return 74
  _pm2_installed_dump_is_safe "$primary" || return 74
  _pm2_installed_dump_is_safe "$backup" || return 74
  cmp -s -- "$primary" "$backup" || return 74
  _pm2_process_json_matches "$primary" "$release_dir" "$@"
}

empty_pm2_dumps_match() {
  if [[ $# -ne 1 || $1 != /* ]]; then
    return 64
  fi
  local pm2_home=$1 primary="$1/dump.pm2" backup="$1/dump.pm2.bak"
  _pm2_home_is_safe "$pm2_home" || return 74
  _pm2_installed_dump_is_safe "$primary" || return 74
  _pm2_installed_dump_is_safe "$backup" || return 74
  cmp -s -- "$primary" "$backup" || return 74
  _pm2_empty_json_array "$primary"
}

write_empty_pm2_dumps_durably() {
  if [[ $# -ne 1 || $1 != /* ]]; then
    return 64
  fi
  local pm2_home=$1 primary="$1/dump.pm2" backup="$1/dump.pm2.bak"
  _pm2_home_is_safe "$pm2_home" || return 74
  _pm2_existing_dump_target_is_safe "$primary" || return 74
  _pm2_existing_dump_target_is_safe "$backup" || return 74
  _pm2_atomic_write_empty "$primary" "$pm2_home" || return 74
  _pm2_atomic_write_empty "$backup" "$pm2_home" || return 74
  empty_pm2_dumps_match "$pm2_home"
}

persist_pm2_state_durably() {
  if [[ $# -lt 2 || $1 != /* || $2 != /* ]]; then
    echo "persist_pm2_state_durably requires absolute PM2 home and release paths" >&2
    return 64
  fi
  local pm2_home=$1 release_dir=$2 primary backup
  shift 2
  primary="$pm2_home/dump.pm2"
  backup="$pm2_home/dump.pm2.bak"

  _pm2_home_is_safe "$pm2_home" || return 74
  [[ -d $release_dir && ! -L $release_dir &&
      $(realpath -e -- "$release_dir") == "$release_dir" ]] || return 74
  _pm2_existing_dump_target_is_safe "$primary" || return 74
  _pm2_existing_dump_target_is_safe "$backup" || return 74
  pm2_live_processes_match "$release_dir" "$@" || return 75
  pm2 save --force || return 75
  [[ -f $primary && ! -L $primary &&
      $(stat -c '%U:%h' -- "$primary") == "$(id -un):1" ]] || return 74
  chmod 0600 -- "$primary" || return 74
  _pm2_process_json_matches "$primary" "$release_dir" "$@" || return 75

  # PM2's backup write is best-effort and its error is swallowed. Reinstall the
  # already-validated primary atomically, then derive an identical backup from
  # it and fsync both replacements before accepting the state.
  _pm2_atomic_copy "$primary" "$primary" "$pm2_home" || return 74
  _pm2_atomic_copy "$primary" "$backup" "$pm2_home" || return 74
  persist_pm2_dumps_match "$pm2_home" "$release_dir" "$@"
}

quiesce_pm2_control_plane_fail_closed() {
  if [[ $# -ne 1 || $1 != /* ]]; then
    return 64
  fi
  local pm2_home=$1 cleanup_failed=false unit_status=0 process_list_status=0

  pm2_live_processes_are_empty || process_list_status=$?
  if [[ $process_list_status -ne 0 ]]; then
    if [[ $process_list_status -ne 1 ]]; then
      echo "PM2 process list could not be read safely before delete" >&2
      cleanup_failed=true
    fi
    if ! pm2 delete all; then
      cleanup_failed=true
      pm2 delete all || true
    fi
  fi
  process_list_status=0
  pm2_live_processes_are_empty || process_list_status=$?
  if [[ $process_list_status -ne 0 ]]; then
    echo "PM2 managed processes remained after delete" >&2
    cleanup_failed=true
  fi
  if ! write_empty_pm2_dumps_durably "$pm2_home"; then
    echo "PM2 empty primary and backup dumps could not be installed" >&2
    cleanup_failed=true
  fi
  if ! systemctl_control stop balanz-pm2.service; then
    echo "PM2 systemd unit stop failed" >&2
    cleanup_failed=true
    systemctl_control stop balanz-pm2.service || true
  fi
  if ! pm2 kill; then
    echo "PM2 daemon kill failed" >&2
    cleanup_failed=true
    pm2 kill || true
  fi
  systemctl_control is-active --quiet balanz-pm2.service || unit_status=$?
  if [[ $unit_status -ne 3 ]]; then
    echo "PM2 systemd unit did not return the exact inactive status 3" >&2
    cleanup_failed=true
  fi
  if [[ -e $pm2_home/pm2.pid || -L $pm2_home/pm2.pid ]]; then
    echo "PM2 daemon PID remained after kill" >&2
    cleanup_failed=true
  fi
  if ! empty_pm2_dumps_match "$pm2_home"; then
    echo "PM2 primary and backup dumps are not durably empty" >&2
    cleanup_failed=true
  fi

  [[ $cleanup_failed == false ]]
}
