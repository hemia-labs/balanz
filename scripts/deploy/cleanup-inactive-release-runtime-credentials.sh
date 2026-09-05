#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 || $1 != /* || $2 != /* ]]; then
  echo "usage: cleanup-inactive-release-runtime-credentials.sh /absolute/release /absolute/deploy-root" >&2
  exit 64
fi

release_dir=$(realpath -e -- "$1")
deploy_root=$(realpath -e -- "$2")
releases_root=$(realpath -e -- "$deploy_root/releases")
config_root=$(realpath -e -- "$deploy_root/runtime-config")
current_link="$deploy_root/current"
release_id=$(basename -- "$release_dir")
candidate_config="$config_root/$release_id"

if [[ $(dirname -- "$release_dir") != "$releases_root" ||
      ! $release_id =~ ^[A-Za-z0-9._-]+$ ||
      ! -d $candidate_config || -L $candidate_config ||
      $(dirname -- "$candidate_config") != "$config_root" ]]; then
  echo "release runtime credential path is unsafe" >&2
  exit 72
fi

remove_config_tree() {
  local target=$1
  if [[ ! -d $target || -L $target || $(dirname -- "$target") != "$config_root" ]]; then
    echo "refusing to remove an unsafe runtime configuration tree" >&2
    return 74
  fi
  find -P "$target" -depth -mindepth 0 -delete
  [[ ! -e $target && ! -L $target ]]
}

if [[ ! -L $current_link || $(readlink -f -- "$current_link") != "$release_dir" ]]; then
  remove_config_tree "$candidate_config"
  exit 0
fi

# Keep all configuration for the active release. Keep only the previous API
# configuration required by the already-proven immediate rollback. Worker and
# migrator credentials from previous/older releases are never retained.
previous_id=''
marker="$release_dir/.rollback-api-compatible"
if [[ -f $marker && ! -L $marker && $(stat -c '%a' -- "$marker") == 600 ]]; then
  IFS= read -r previous_release <"$marker" || true
  if [[ -n ${previous_release:-} && -d $previous_release &&
        $(dirname -- "$previous_release") == "$releases_root" ]]; then
    previous_id=$(basename -- "$previous_release")
  fi
fi

while IFS= read -r -d '' config_dir; do
  config_id=$(basename -- "$config_dir")
  if [[ $config_id == "$release_id" ]]; then
    rm -f -- "$config_dir/migrator/runtime.env"
    continue
  fi
  if [[ -n $previous_id && $config_id == "$previous_id" ]]; then
    rm -rf -- "$config_dir/worker" "$config_dir/migrator"
    continue
  fi
  remove_config_tree "$config_dir"
done < <(find -P "$config_root" -mindepth 1 -maxdepth 1 -type d -print0)

if find -P "$config_root" -mindepth 2 -maxdepth 3 \
  \( -path '*/worker/runtime.env' -o -path '*/migrator/runtime.env' \) \
  ! -path "$candidate_config/*" -print -quit | grep -q .; then
  echo "inactive worker or migrator configuration remains" >&2
  exit 74
fi
