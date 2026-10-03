#!/usr/bin/env bash
# Deploys the contracts to Base Sepolia (staging) and writes packages/shared/src/deployments/84532.json:
#   1. packages/council: the rails (AlmaAnchorRegistry, AtlasRegistry), the organizations and AldeaCouncilExecutor
#      (COUNCIL_DELAY = 600 s on staging), verified on Basescan
#   2. the MUD World with ALMA_REGISTRY_ADDRESS (PostDeploy seeds Config, tribes and buildings)
#   3. World and system addresses merged into the deployment file
#
# Required: PRIVATE_KEY (deployer with Base Sepolia ETH; never the Safe's key), BASESCAN_API_KEY
# Optional: ALDEA_SAFE_ADDRESS (default: the deployer keeps the roles), RELAYER_ADDRESS, BASE_SEPOLIA_RPC_URL
# Usage: CONFIRM=base-sepolia scripts/deploy-staging.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
CHAIN_ID=84532
DEPLOYMENT="$ROOT/packages/shared/src/deployments/$CHAIN_ID.json"

: "${PRIVATE_KEY:?PRIVATE_KEY is required (the deployer, with Base Sepolia ETH)}"
: "${BASESCAN_API_KEY:?BASESCAN_API_KEY is required to verify the contracts}"
if [ "${CONFIRM:-}" != "base-sepolia" ]; then
  echo "This sends real transactions to Base Sepolia. Run again with CONFIRM=base-sepolia." >&2
  exit 1
fi
if [ "$(cast chain-id --rpc-url "$RPC_URL")" != "$CHAIN_ID" ]; then
  echo "$RPC_URL is not Base Sepolia ($CHAIN_ID)" >&2
  exit 1
fi
if [ -f "$DEPLOYMENT" ]; then
  echo "$DEPLOYMENT already exists: staging is deployed. Remove it only to redeploy from scratch." >&2
  exit 1
fi

DEPLOYER="$(cast wallet address "$PRIVATE_KEY")"
echo "deployer $DEPLOYER · balance $(cast balance "$DEPLOYER" --ether --rpc-url "$RPC_URL") ETH"
export COUNCIL_DELAY="${COUNCIL_DELAY:-600}"
export ETHERSCAN_API_KEY="$BASESCAN_API_KEY"

echo "▸ rails and council"
(cd "$ROOT/packages/council" && forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --verify)

ALMA_REGISTRY_ADDRESS="$(node -e "console.log(require('$DEPLOYMENT').protocol.almaAnchorRegistry)")"
export ALMA_REGISTRY_ADDRESS
echo "▸ world (AlmaAnchorRegistry $ALMA_REGISTRY_ADDRESS)"
(cd "$ROOT/packages/contracts" && pnpm mud deploy --profile=base-sepolia --rpc "$RPC_URL")

echo "▸ addresses"
pnpm --dir "$ROOT/packages/shared" merge-world --chain-id "$CHAIN_ID" --rpc-url "$RPC_URL"

cat <<NEXT
✓ deployed: $DEPLOYMENT

Next:
  1. Register it in packages/shared/src/deployments/index.ts (import the JSON into \`committed[$CHAIN_ID]\`) and commit both.
  2. Set WORLD_ADDRESS and ALMA_REGISTRY_ADDRESS on the Resolver, and STORE_ADDRESS / START_BLOCK on the indexer.
  3. Add both addresses and the sponsored functions (packages/shared/src/sponsorship.ts) to the CDP paymaster allowlist.
  4. See infra/README.md for the services.
NEXT
