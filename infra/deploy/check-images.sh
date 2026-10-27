#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
revision=${GITHUB_SHA:-$(git rev-parse HEAD)}
api_version=$(node -p 'require("./apps/api/package.json").version')
web_version=$(node -p 'require("./apps/web/package.json").version')
docker build --platform linux/amd64 -f apps/api/Dockerfile -t balanz-api:test \
  --label "org.opencontainers.image.revision=$revision" \
  --label "org.opencontainers.image.version=$api_version" .
docker build --platform linux/amd64 -f apps/web/Dockerfile -t balanz-web:test \
  --label "org.opencontainers.image.revision=$revision" \
  --label "org.opencontainers.image.version=$web_version" \
  --label io.hemia.api-url=https://api-contable.hemia.dev/api/v1 .
python3 infra/deploy/image-smoke.py
