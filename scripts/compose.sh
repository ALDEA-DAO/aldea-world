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
exec "${engine[@]}" -f "$ROOT/infra/compose.yml" "$@"
