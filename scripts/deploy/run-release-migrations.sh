#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 || $1 != /* || $2 != /* ]]; then
  echo "usage: run-release-migrations.sh /absolute/release /absolute/deploy-root" >&2
  exit 64
fi

release_dir=$(realpath -e -- "$1")
deploy_root=$(realpath -e -- "$2")
releases_root=$(realpath -e -- "$deploy_root/releases")
release_id=$(basename -- "$release_dir")
api_dir="$release_dir/apps/api"
migration_dir="$deploy_root/runtime-config/$release_id/migrator"
migration_env="$migration_dir/runtime.env"
temporary=''

cleanup_credentials() {
  local status=$?
  trap - EXIT HUP INT TERM

  if [[ -n $temporary && ( -e $temporary || -L $temporary ) ]]; then
    rm -f -- "$temporary" || status=74
  fi
  if [[ -e $migration_env || -L $migration_env ]]; then
    rm -f -- "$migration_env" || status=74
  fi
  if [[ -e $migration_env || -L $migration_env ]]; then
    echo "migration credential cleanup could not be verified" >&2
    status=74
  fi

  exit "$status"
}

trap cleanup_credentials EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ $(dirname -- "$release_dir") != "$releases_root" ||
      ! $release_id =~ ^[A-Za-z0-9._-]+$ ||
      ! -d $api_dir || -L $api_dir || ! -f $api_dir/package.json ]]; then
  echo "release API directory is missing or unsafe" >&2
  exit 72
fi
if [[ ! -d $migration_dir || -L $migration_dir ||
      $(stat -c '%U:%G:%a' -- "$migration_dir") != "$(id -un):balanz-migrator-config:750" ]]; then
  echo "isolated migrator configuration directory is unsafe" >&2
  exit 74
fi
if find -P "$api_dir" -mindepth 1 -maxdepth 1 -name '.env*' \
  -print -quit | grep -q .; then
  echo "migration environment files must not exist inside a release" >&2
  exit 74
fi
if [[ ! -x /usr/local/bin/bun || -L /usr/local/bin/bun ||
      ! -x /usr/bin/sudo || -L /usr/bin/sudo ]]; then
  echo "system Bun 1.3.2 must be installed for the isolated migrator" >&2
  exit 69
fi
if [[ $(/usr/local/bin/bun --version) != 1.3.2 ]]; then
  echo "isolated migrations require the validated system Bun 1.3.2" >&2
  exit 69
fi
migrator_home=$(getent passwd balanz-migrator | cut -d: -f6)
if [[ -z $migrator_home || $(id -u balanz-migrator) -eq 0 ]]; then
  echo "isolated migrator identity is unavailable or privileged" >&2
  exit 69
fi

# Remove only a stale deploy-time credential from this candidate. It lives in
# a migrator-only directory outside the release and is never readable by API,
# worker or web runtime identities.
rm -f -- "$migration_env"
if [[ -e $migration_env || -L $migration_env ]]; then
  echo "could not clear a stale migration credential" >&2
  exit 74
fi

umask 077
temporary=$(mktemp -- "$migration_dir/.migration-config.XXXXXX")
cat >"$temporary"
if [[ ! -s $temporary ]]; then
  echo "refusing to run migrations with an empty credential file" >&2
  exit 65
fi
chgrp -- balanz-migrator-config "$temporary"
chmod 0640 -- "$temporary"
if [[ $(stat -c '%U:%G:%a' -- "$temporary") != "$(id -un):balanz-migrator-config:640" ]]; then
  echo "could not enforce isolated migration credential ownership" >&2
  exit 74
fi

mv -T -- "$temporary" "$migration_env"
temporary=''
if [[ -L $migration_env ||
      $(stat -c '%U:%G:%a' -- "$migration_env") != "$(id -un):balanz-migrator-config:640" ]]; then
  echo "migration credentials were not installed safely" >&2
  exit 74
fi

for runtime_user in balanz-web balanz-api balanz-worker; do
  if /usr/bin/sudo -n -u "$runtime_user" -- test -r "$migration_env"; then
    echo "$runtime_user can read isolated migration credentials" >&2
    exit 77
  fi
done
if /usr/bin/sudo -n -u balanz-migrator -- test -w "$migration_env"; then
  echo "migrator runtime can rewrite its own credentials" >&2
  exit 77
fi

/usr/bin/sudo -n -u balanz-migrator -- \
  /usr/bin/env -i \
  --chdir="$api_dir" \
  "HOME=$migrator_home" \
  'PATH=/usr/local/bin:/usr/bin:/bin' \
  /usr/local/bin/bun --env-file="$migration_env" run release:prepare

# EXIT always removes and verifies the deploy-time credential before success is
# returned to the workflow.
