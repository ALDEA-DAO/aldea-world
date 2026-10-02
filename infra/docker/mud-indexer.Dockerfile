# MUD's store indexer (Postgres): `postgres-indexer` follows the World and `postgres-frontend` serves the client's
# initial sync. Both come from @latticexyz/store-indexer, pinned in the root package.json.
#   podman build -f infra/docker/mud-indexer.Dockerfile -t mud-indexer .
FROM node:22-slim
ENV NODE_ENV=production CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Only the root package: the indexer does not need the workspace
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter aldea-world
USER node
EXPOSE 3001
CMD ["pnpm", "exec", "postgres-frontend"]
