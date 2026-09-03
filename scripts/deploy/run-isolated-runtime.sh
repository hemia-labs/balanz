#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 || $# -gt 2 || ! $1 =~ ^(web|api|worker)$ || ( $# -eq 2 && $2 != --check ) ]]; then
  echo "usage: run-isolated-runtime.sh web|api|worker [--check]" >&2
  exit 64
fi

profile=$1
check_only=${2:-}
script_path=$(realpath -e -- "${BASH_SOURCE[0]}")
release_dir=$(realpath -e -- "$(dirname -- "$script_path")/../..")
releases_root=$(realpath -e -- "$(dirname -- "$release_dir")")
deploy_root=$(realpath -e -- "$(dirname -- "$releases_root")")
release_id=$(basename -- "$release_dir")
orchestrator=$(id -un)
node_binary=/usr/local/bin/node
sudo_binary=/usr/bin/sudo

if [[ $(basename -- "$releases_root") != releases || ! $release_id =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "runtime release topology is invalid" >&2
  exit 72
fi

case "$profile" in
  web)
    runtime_user=balanz-web
    runtime_group=balanz-runtime
    runtime_cwd="$release_dir/apps/web"
    entrypoint="$runtime_cwd/node_modules/next/dist/bin/next"
    config_file=''
    runtime_args=(start --hostname 127.0.0.1 --port 5181)
    ;;
  api)
    runtime_user=balanz-api
    runtime_group=balanz-api-config
    runtime_cwd="$release_dir/apps/api"
    entrypoint="$runtime_cwd/dist/main.js"
    config_file="$deploy_root/runtime-config/$release_id/api/runtime.env"
    runtime_args=()
    ;;
  worker)
    runtime_user=balanz-worker
    runtime_group=balanz-worker-config
    runtime_cwd="$release_dir/apps/api"
    entrypoint="$runtime_cwd/dist/worker.js"
    config_file="$deploy_root/runtime-config/$release_id/worker/runtime.env"
    runtime_args=()
    ;;
esac

runtime_home=$(getent passwd "$runtime_user" | cut -d: -f6)
if [[ -z $runtime_home || $(id -u "$runtime_user") -eq 0 ]]; then
  echo "$profile runtime identity is unavailable or privileged" >&2
  exit 77
fi
if [[ ! -x $node_binary || -L $node_binary || ! -x $sudo_binary || -L $sudo_binary ||
      ! -d $runtime_cwd || -L $runtime_cwd || ! -f $entrypoint || -L $entrypoint ]]; then
  echo "$profile runtime executable topology is invalid" >&2
  exit 72
fi

if [[ -n $config_file ]]; then
  config_dir=$(dirname -- "$config_file")
  if [[ ! -d $config_dir || -L $config_dir || ! -f $config_file || -L $config_file ]]; then
    echo "$profile runtime configuration is missing or unsafe" >&2
    exit 74
  fi
  if [[ $(stat -c '%U:%G:%a' -- "$config_dir") != "$orchestrator:$runtime_group:750" ||
        $(stat -c '%U:%G:%a' -- "$config_file") != "$orchestrator:$runtime_group:640" ]]; then
    echo "$profile runtime configuration ownership or mode is unsafe" >&2
    exit 74
  fi
fi

if "$sudo_binary" -n -u "$runtime_user" -- test -w "$release_dir" ||
   "$sudo_binary" -n -u "$runtime_user" -- test -w "$release_dir/ecosystem.config.cjs"; then
  echo "$profile runtime can modify its release" >&2
  exit 77
fi
if [[ -n $config_file ]] && "$sudo_binary" -n -u "$runtime_user" -- test -w "$config_file"; then
  echo "$profile runtime can modify its configuration" >&2
  exit 77
fi

for sibling in api worker migrator; do
  [[ $sibling == "$profile" ]] && continue
  sibling_file="$deploy_root/runtime-config/$release_id/$sibling/runtime.env"
  if [[ ( -e $sibling_file || -L $sibling_file ) ]] &&
     "$sudo_binary" -n -u "$runtime_user" -- test -r "$sibling_file"; then
    echo "$profile runtime can read $sibling configuration" >&2
    exit 77
  fi
done

if [[ $check_only == --check ]]; then
  printf '%s\n' PASS
  exit 0
fi

common_environment=(
  -i
  --chdir="$runtime_cwd"
  "HOME=$runtime_home"
  'PATH=/usr/local/bin:/usr/bin:/bin'
  'NODE_ENV=production'
)

if [[ -n $config_file ]]; then
  exec "$sudo_binary" -n -u "$runtime_user" -- \
    /usr/bin/env "${common_environment[@]}" \
    "$node_binary" --env-file="$config_file" "$entrypoint" "${runtime_args[@]}"
else
  exec "$sudo_binary" -n -u "$runtime_user" -- \
    /usr/bin/env "${common_environment[@]}" \
    "$node_binary" "$entrypoint" "${runtime_args[@]}"
fi
