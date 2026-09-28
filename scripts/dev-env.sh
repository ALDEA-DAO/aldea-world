#!/usr/bin/env bash
# Prints `export` lines with the local addresses from packages/shared/src/deployments/31337.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node -e "
const d = require('$ROOT/packages/shared/src/deployments/31337.json');
const out = {
  WORLD_ADDRESS: d.world.address, STORE_ADDRESS: d.world.address, START_BLOCK: d.world.blockNumber,
  ALMA_REGISTRY_ADDRESS: d.protocol.almaAnchorRegistry, ATLAS_ADDRESS: d.protocol.atlasRegistry,
  COUNCIL_ADDRESS: d.protocol.aldeaCouncilExecutor,
};
for (const [k, v] of Object.entries(out)) console.log('export ' + k + '=' + v);
"
