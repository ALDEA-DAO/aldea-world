#!/usr/bin/env bash
# Waits until scripts/dev-deploy.sh has written the World addresses for the running anvil.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOYMENT="$ROOT/packages/shared/src/deployments/31337.json"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
for _ in $(seq 1 300); do
  if [ -f "$DEPLOYMENT" ] && grep -q '"world"' "$DEPLOYMENT"; then
    world="$(node -e "console.log(require('$DEPLOYMENT').world.address)")"
    code="$(cast code "$world" --rpc-url "$RPC_URL" 2>/dev/null || true)"
    [ -n "$code" ] && [ "$code" != "0x" ] && exit 0
  fi
  sleep 1
done
echo "timed out waiting for the local deployment" >&2
exit 1
