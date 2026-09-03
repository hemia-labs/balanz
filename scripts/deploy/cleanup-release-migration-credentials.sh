#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 || $1 != /* || $2 != /* ]]; then
  echo "usage: cleanup-release-migration-credentials.sh /absolute/release /absolute/deploy-root" >&2
  exit 64
fi

release_dir=$(realpath -e -- "$1")
deploy_root=$(realpath -e -- "$2")
releases_root=$(realpath -e -- "$deploy_root/releases")
release_id=$(basename -- "$release_dir")
migration_dir="$deploy_root/runtime-config/$release_id/migrator"
migration_env="$migration_dir/runtime.env"

if [[ $(dirname -- "$release_dir") != "$releases_root" ||
      ! $release_id =~ ^[A-Za-z0-9._-]+$ ||
      ! -d $migration_dir || -L $migration_dir ||
      $(stat -c '%U:%G:%a' -- "$migration_dir") != "$(id -un):balanz-migrator-config:750" ]]; then
  echo "isolated migration credential path is unsafe" >&2
  exit 72
fi

rm -f -- "$migration_env"
find "$migration_dir" \
  -mindepth 1 \
  -maxdepth 1 \
  -name '.migration-config.*' \
  \( -type f -o -type l \) \
  -delete

leftover=$(find "$migration_dir" -mindepth 1 -maxdepth 1 -name '.migration-config.*' -print -quit)
if [[ -e $migration_env || -L $migration_env || -n $leftover ]]; then
  echo "migration credential cleanup could not be verified" >&2
  exit 74
fi
