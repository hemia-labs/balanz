#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 3 || $1 != /* || $2 != /* || ! $3 =~ ^(api|worker)$ ]]; then
  echo "usage: write-secret-file.sh /absolute/release /absolute/deploy-root api|worker" >&2
  exit 64
fi

release_dir=$(realpath -e -- "$1")
deploy_root=$(realpath -e -- "$2")
releases_root=$(realpath -e -- "$deploy_root/releases")
release_id=$(basename -- "$release_dir")
profile=$3
case "$profile" in
  api) expected_group=balanz-api-config ;;
  worker) expected_group=balanz-worker-config ;;
esac
parent="$deploy_root/runtime-config/$release_id/$profile"
target="$parent/runtime.env"
temporary=''

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

if [[ $(dirname -- "$release_dir") != "$releases_root" || ! $release_id =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "release path is outside the deployment releases directory" >&2
  exit 72
fi
if [[ ! -d $parent || -L $parent ||
      $(stat -c '%U:%G:%a' -- "$parent") != "$(id -un):$expected_group:750" ]]; then
  echo "$profile secret target parent is unsafe" >&2
  exit 73
fi
if [[ -L $target || -d $target ]]; then
  echo "refusing to replace an unsafe runtime configuration target" >&2
  exit 73
fi

umask 077
temporary=$(mktemp -- "$parent/.runtime-config.XXXXXX")
cat >"$temporary"
if [[ ! -s $temporary ]]; then
  echo "refusing to install an empty runtime configuration" >&2
  exit 65
fi
chgrp -- "$expected_group" "$temporary"
chmod 0640 -- "$temporary"
if [[ $(stat -c '%U:%G:%a' -- "$temporary") != "$(id -un):$expected_group:640" ]]; then
  echo "could not enforce isolated runtime configuration ownership" >&2
  exit 74
fi

mv -T -- "$temporary" "$target"
temporary=''
if [[ -L $target ||
      $(stat -c '%U:%G:%a' -- "$target") != "$(id -un):$expected_group:640" ]]; then
  echo "installed runtime configuration is unsafe" >&2
  exit 74
fi

trap - EXIT HUP INT TERM
