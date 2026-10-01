# The Effectstream node: its packages only export the "bun" condition, so it runs on Bun.
#   podman build -f infra/docker/effectstream-node.Dockerfile -t effectstream-node .
FROM node:22-slim
ENV NODE_ENV=production CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && npm install -g bun@1.4.2
WORKDIR /app
COPY . .
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter "@aldea/effectstream-node..."
USER node
WORKDIR /app/packages/effectstream-node
# 9999: read API and /health · 9883: MQTT over WebSocket (browsers) · 8883: MQTT over TCP
EXPOSE 9999 9883 8883
CMD ["bun", "src/index.ts"]
