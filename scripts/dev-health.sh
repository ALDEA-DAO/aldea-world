#!/usr/bin/env bash
# Checks every local service: anvil, ALMA Resolver, Effectstream, relay worker, vote batcher, MUD indexer and client.
set -uo pipefail
fail=0
check() {
  local name="$1" url="$2" body
  if body="$(curl -sf -m 3 "$url")"; then printf '✓ %-16s %s  %s\n' "$name" "$url" "${body:0:80}"
  else printf '✗ %-16s %s\n' "$name" "$url"; fail=1; fi
}
if curl -sf -m 3 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' http://127.0.0.1:8545 >/dev/null; then
  printf '✓ %-16s %s\n' anvil http://127.0.0.1:8545
else printf '✗ %-16s %s\n' anvil http://127.0.0.1:8545; fail=1; fi
check alma-resolver http://127.0.0.1:8787/health
check effectstream http://127.0.0.1:9999/health
check relay-worker http://127.0.0.1:8788/health
check batcher http://127.0.0.1:3334/health
check mud-indexer http://127.0.0.1:3101/healthz
check client http://127.0.0.1:3100/health
exit $fail
