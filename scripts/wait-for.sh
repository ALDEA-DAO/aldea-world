#!/usr/bin/env bash
# Waits until an HTTP JSON-RPC endpoint (anvil) or a TCP port answers: wait-for.sh http://127.0.0.1:8545 | wait-for.sh 5432
set -euo pipefail
target="$1"; timeout="${2:-120}"
for _ in $(seq 1 "$timeout"); do
  if [[ "$target" == http* ]]; then
    curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$target" >/dev/null && exit 0
  else
    (echo >"/dev/tcp/127.0.0.1/$target") 2>/dev/null && exit 0
  fi
  sleep 1
done
echo "timed out waiting for $target" >&2
exit 1
