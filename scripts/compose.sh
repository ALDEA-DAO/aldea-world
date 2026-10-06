#!/usr/bin/env bash
# Runs the local infrastructure (infra/compose.yml) with Podman when available, otherwise Docker.
#   scripts/compose.sh up        scripts/compose.sh down -v
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if command -v podman >/dev/null 2>&1; then
  engine=(podman compose)
elif command -v docker >/dev/null 2>&1; then
  engine=(docker compose)
else
  echo "Install Podman (recommended) or Docker to run the local infrastructure, or use 'pnpm dev:lite'." >&2
  exit 1
fi
# Podman prints a banner when it delegates to podman-compose; keep the output clean
export PODMAN_COMPOSE_WARNING_LOGS=false
compose=("${engine[@]}" -f "$ROOT/infra/compose.yml")

# `up` over containers that are already running (pnpm dev started again): starting them a second time only prints
# errors, so follow their logs instead.
if [ "$*" = "up" ]; then
  services="$("${compose[@]}" config --services 2>/dev/null | wc -l)"
  running="$("${engine[0]}" ps --filter "label=com.docker.compose.project=aldea-world" --filter status=running -q | wc -l)"
  if [ "$services" -gt 0 ] && [ "$running" -ge "$services" ]; then
    echo "✓ the infrastructure is already running"
    exec "${compose[@]}" logs -f --tail 20
  fi
fi
exec "${compose[@]}" "$@"
