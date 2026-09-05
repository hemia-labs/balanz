#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 || $1 != /* || $2 != /* ]]; then
  echo "usage: prepare-runtime-isolation.sh /absolute/release /absolute/deploy-root" >&2
  exit 64
fi

release_dir=$(realpath -e -- "$1")
deploy_root=$(realpath -e -- "$2")
releases_root=$(realpath -e -- "$deploy_root/releases")
release_id=$(basename -- "$release_dir")
config_root="$deploy_root/runtime-config"
release_config="$config_root/$release_id"

if [[ $(dirname -- "$release_dir") != "$releases_root" || ! $release_id =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "release must be a direct, safely named child of the releases directory" >&2
  exit 72
fi

for group in balanz-runtime balanz-api-config balanz-worker-config balanz-migrator-config; do
  getent group "$group" >/dev/null || {
    echo "required runtime isolation group is absent: $group" >&2
    exit 77
  }
  id -nG "$(id -un)" | tr ' ' '\n' | grep -Fxq "$group" || {
    echo "deployment identity is not a member of $group" >&2
    exit 77
  }
done

while IFS= read -r -d '' link_path; do
  link_target=$(readlink -- "$link_path") || {
    echo "release contains an unreadable symbolic link" >&2
    exit 74
  }
  [[ $link_target != /* ]] || {
    echo "release symbolic links must use relative in-release targets" >&2
    exit 74
  }
  lexical_target=$(realpath -m -s -- "$(dirname -- "$link_path")/$link_target") || {
    echo "release symbolic link cannot be normalized safely" >&2
    exit 74
  }
  case "$lexical_target" in
    "$release_dir"|"$release_dir"/*) ;;
    *)
      echo "release symbolic link lexically escapes the release" >&2
      exit 74
      ;;
  esac
  resolved_link=$(realpath -e -- "$link_path") || {
    echo "release contains a dangling symbolic link" >&2
    exit 74
  }
  case "$resolved_link" in
    "$release_dir"|"$release_dir"/*) ;;
    *)
      echo "release symbolic links must resolve inside the release" >&2
      exit 74
      ;;
  esac
done < <(find -P "$release_dir" -type l -print0)

chgrp -- balanz-runtime "$deploy_root" "$releases_root" "$release_dir"
chmod 0750 -- "$deploy_root" "$releases_root" "$release_dir"
chgrp -R --no-dereference balanz-runtime "$release_dir"
find -P "$release_dir" -type d -exec chmod 0750 -- {} +
find -P "$release_dir" -type f -perm /0100 -exec chmod 0750 -- {} +
find -P "$release_dir" -type f ! -perm /0100 -exec chmod 0640 -- {} +

install -d -m 0750 -g balanz-runtime -- "$config_root" "$release_config"
install -d -m 0750 -g balanz-api-config -- "$release_config/api"
install -d -m 0750 -g balanz-worker-config -- "$release_config/worker"
install -d -m 0750 -g balanz-migrator-config -- "$release_config/migrator"

for path in "$deploy_root" "$releases_root" "$release_dir" "$config_root" "$release_config"; do
  [[ ! -L $path && $(stat -c '%U:%G:%a' -- "$path") == "$(id -un):balanz-runtime:750" ]] || {
    echo "shared runtime path ownership is unsafe" >&2
    exit 74
  }
done

for specification in \
  "api:balanz-api-config" \
  "worker:balanz-worker-config" \
  "migrator:balanz-migrator-config"; do
  profile=${specification%%:*}
  group=${specification#*:}
  path="$release_config/$profile"
  [[ ! -L $path && $(stat -c '%U:%G:%a' -- "$path") == "$(id -un):$group:750" ]] || {
    echo "$profile configuration directory ownership is unsafe" >&2
    exit 74
  }
done
