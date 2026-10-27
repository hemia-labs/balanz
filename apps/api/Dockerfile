# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS dependencies
COPY --from=oven/bun:1.3.2 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY apps/api ./apps/api
RUN bun run --cwd apps/api build

FROM dependencies AS production-dependencies
RUN rm -rf node_modules apps/api/node_modules apps/web/node_modules \
    && bun install --frozen-lockfile --production --ignore-scripts --filter api

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/ ./
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 3021 3002
# Override this probe when using the worker command (see the image runbook).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT||3021)+'/liveness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
