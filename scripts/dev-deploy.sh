#!/usr/bin/env bash
# Deploys everything to the local anvil, in order:
#   1. packages/council: the shared rails (AlmaAnchorRegistry, AtlasRegistry), the orgs and AldeaCouncilExecutor
#      → deployments/31337.json
#   2. the MUD World with ALMA_REGISTRY_ADDRESS (PostDeploy seeds Config, tribes and buildings)
#   3. World and system addresses merged into packages/shared/src/deployments/31337.json
# Services wait for the "world" key in that file (scripts/wait-for-deploy.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
# anvil's default account 0: a well-known development key, never used outside local chains
export PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
export COUNCIL_DELAY="${COUNCIL_DELAY:-600}"
DEPLOYMENT="$ROOT/packages/shared/src/deployments/31337.json"

"$ROOT/scripts/wait-for.sh" "$RPC_URL"
rm -f "$DEPLOYMENT"

echo "▸ rails and council"
(cd "$ROOT/packages/council" && forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --silent)

ALMA_REGISTRY_ADDRESS="$(node -e "console.log(require('$DEPLOYMENT').protocol.almaAnchorRegistry)")"
export ALMA_REGISTRY_ADDRESS
echo "▸ world (AlmaAnchorRegistry $ALMA_REGISTRY_ADDRESS)"
(cd "$ROOT/packages/contracts" && pnpm mud deploy --rpc "$RPC_URL")

echo "▸ addresses"
pnpm --dir "$ROOT/packages/shared" merge-world --chain-id 31337 --rpc-url "$RPC_URL"
echo "✓ deployed: $DEPLOYMENT"
