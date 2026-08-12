# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.13.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN npm install --global corepack@0.34.5 \
    && corepack enable \
    && corepack prepare pnpm@10.34.5 --activate
WORKDIR /workspace

FROM toolchain AS builder
COPY . .
RUN --mount=type=cache,id=tasktwin-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter @tasktwin/api... \
    --filter @tasktwin/notification-worker... \
    --filter @tasktwin/web... build
RUN pnpm --filter @tasktwin/api deploy --prod --legacy /output/api \
    && pnpm --filter @tasktwin/notification-worker deploy --prod --legacy /output/notification-worker \
    && pnpm --filter @tasktwin/database deploy --legacy /output/migrate \
    && for output in /output/api /output/notification-worker /output/migrate; do \
      rm -rf "$output/src" "$output/test" "$output/coverage"; \
      for package in "$output"/node_modules/@tasktwin/*; do \
        rm -rf "$package/src" "$package/test" "$package/coverage"; \
      done; \
    done

FROM base AS runtime
ENV NODE_ENV=production
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
USER node

FROM runtime AS api
COPY --from=builder --chown=node:node /output/api/ ./
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM runtime AS scheduler
COPY --from=builder --chown=node:node /output/api/ ./
CMD ["node", "dist/scheduler/main.js"]

FROM runtime AS notification-worker
COPY --from=builder --chown=node:node /output/notification-worker/ ./
CMD ["node", "dist/index.js"]

FROM runtime AS migrate
COPY --from=builder --chown=node:node /output/migrate/ ./
CMD ["node", "scripts/migrate-deploy.mjs"]

FROM runtime AS web
COPY --from=builder --chown=node:node /workspace/apps/web/.next/standalone/ ./
COPY --from=builder --chown=node:node /workspace/apps/web/.next/static/ ./apps/web/.next/static/
COPY --from=builder --chown=node:node /workspace/apps/web/scripts/start-production.mjs ./apps/web/start-production.mjs
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "start-production.mjs"]
