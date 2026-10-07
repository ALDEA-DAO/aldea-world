#!/usr/bin/env bash
# Deploys everything to the local anvil, in order:
#   1. packages/council: the shared rails (AlmaAnchorRegistry, AtlasRegistry), the orgs and AldeaCouncilExecutor
#      → deployments/31337.json
#   2. the MUD World with ALMA_REGISTRY_ADDRESS (PostDeploy seeds Config, tribes and buildings)
#   3. ALDEA World registered in the Atlas (its id goes to the deployment file as aldeaWorldId)
#   4. World and system addresses merged into packages/shared/src/deployments/31337.json
# Services wait for the "world" key in that file (scripts/wait-for-deploy.sh).
#
# If that deployment is already on the running chain (`pnpm dev` started again over the same anvil), it is kept, so the
# read models stay in step with it. REDEPLOY=1 deploys again; any new deploy empties Effectstream's and the MUD
# indexer's databases, which store the start block as immutable config.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
# anvil's default account 0: a well-known development key, never used outside local chains
export PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
export COUNCIL_DELAY="${COUNCIL_DELAY:-600}"
# anvil's default account 2, the one the local relay worker signs with: only the relayer may queue Council results
export RELAYER_ADDRESS="${RELAYER_ADDRESS:-0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC}"
DEPLOYMENT="$ROOT/packages/shared/src/deployments/31337.json"

"$ROOT/scripts/wait-for.sh" "$RPC_URL"
if [ -z "${REDEPLOY:-}" ] && "$ROOT/scripts/wait-for-deploy.sh" 1 2>/dev/null; then
  echo "✓ already deployed on this chain: $DEPLOYMENT (REDEPLOY=1 to deploy again)"
  exit 0
fi
rm -f "$DEPLOYMENT"

echo "▸ rails and council"
(cd "$ROOT/packages/council" && forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --silent)

ALMA_REGISTRY_ADDRESS="$(node -e "console.log(require('$DEPLOYMENT').protocol.almaAnchorRegistry)")"
export ALMA_REGISTRY_ADDRESS
echo "▸ world (AlmaAnchorRegistry $ALMA_REGISTRY_ADDRESS)"
(cd "$ROOT/packages/contracts" && pnpm mud deploy --rpc "$RPC_URL")

# Only the containers' Postgres outlives a deploy (pnpm dev:lite keeps its databases in memory and restarts them)
PG_PORT="${ALDEA_PG_PORT:-5442}"
if (echo >"/dev/tcp/127.0.0.1/$PG_PORT") 2>/dev/null; then
  echo "▸ empty read models (effectstream, mud_indexer)"
  for db in effectstream mud_indexer; do
    "$ROOT/scripts/compose.sh" exec -T postgres psql -q -U aldea -d postgres \
      -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" -c "CREATE DATABASE $db OWNER aldea"
  done
fi

# Before the World's addresses: services start as soon as those are written, and read the world's Atlas id then
echo "▸ ALDEA World in the Atlas"
pnpm --dir "$ROOT/packages/shared" register-local-world --chain-id 31337 --rpc-url "$RPC_URL"

echo "▸ addresses"
pnpm --dir "$ROOT/packages/shared" merge-world --chain-id 31337 --rpc-url "$RPC_URL"
echo "✓ deployed: $DEPLOYMENT"
