# A Node service of the monorepo (ALMA Resolver, relay worker), run with tsx from its sources.
#   podman build -f infra/docker/node-service.Dockerfile --build-arg PACKAGE=@aldea/alma-resolver -t alma-resolver .
FROM node:22-slim
ARG PACKAGE
ENV PACKAGE=${PACKAGE} NODE_ENV=production CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY . .
# The package and the workspace packages it depends on (tsx is a devDependency: it runs the service)
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter "${PACKAGE}..."
USER node
CMD ["sh", "-c", "exec pnpm --filter \"$PACKAGE\" start"]
