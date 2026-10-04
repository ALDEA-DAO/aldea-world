#!/usr/bin/env bash
# Runs Dolos, a light Cardano data node, on preprod for local development (config in infra/dolos/preprod).
#
#   scripts/cardano/dolos.sh download   downloads the snapshot to start from (about 3 GB); run it again to resume
#   scripts/cardano/dolos.sh import     unpacks the downloaded snapshot into the node's data (replaces it)
#   scripts/cardano/dolos.sh mithril    instead of download + import: starts next to the chain's tip (about 20 GB)
#   scripts/cardano/dolos.sh up         starts the node in the background; it catches up with the chain from its data
#   scripts/cardano/dolos.sh status     whether it runs, its last log lines and the space it uses
#   scripts/cardano/dolos.sh logs       follows its log
#   scripts/cardano/dolos.sh down       stops it; its data stays
#
# Nothing is downloaded twice: the snapshot is a file that resumes where it stopped and is kept after importing, and
# the node's data lives on this machine (.cardano-preprod/dolos), so stopping or restarting the node continues from
# what it already has. Only `import` discards data, and it restores it from the snapshot file without the network.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOME_DIR="$ROOT/.cardano-preprod/dolos"
CONFIG_DIR="$ROOT/infra/dolos/preprod"
IMAGE="ghcr.io/txpipe/dolos:v1.6.1"
NAME="aldea-dolos-preprod"
# ${VERSION}/${NETWORK}/${VARIANT}/${POINT}: storage v3, network magic 1 (preprod). "ledger" is the ledger state and
# just enough history to keep syncing: the node fetches every later block itself.
SNAPSHOT_URL="https://dolos-snapshots.txpipe.cloud/v3/1/ledger/latest.tar.gz"
SNAPSHOT="$HOME_DIR/snapshots/preprod-ledger.tar.gz"

if command -v podman >/dev/null 2>&1; then engine=podman; else engine=docker; fi

# The node reads its config and genesis next to its data
prepare() {
  mkdir -p "$HOME_DIR/snapshots"
  cp "$CONFIG_DIR"/dolos.toml "$CONFIG_DIR"/*.json "$HOME_DIR/"
}

remote_size() { curl -sIL "$SNAPSHOT_URL" | tr -d '\r' | awk 'tolower($1) == "content-length:" { size = $2 } END { print size }'; }
local_size() { [ -f "$1" ] && stat -c %s "$1" || echo 0; }

case "${1:-}" in
  download)
    prepare
    total="$(remote_size)"
    if [ "$(local_size "$SNAPSHOT")" = "$total" ]; then echo "✓ already downloaded: $SNAPSHOT"; exit 0; fi
    # Into a .part file, continuing from the bytes already there; it only gets its final name when complete
    curl -L --fail --continue-at - --retry 20 --retry-delay 5 --retry-all-errors -o "$SNAPSHOT.part" "$SNAPSHOT_URL"
    if [ "$(local_size "$SNAPSHOT.part")" != "$total" ]; then echo "The download is incomplete: run it again to resume." >&2; exit 1; fi
    mv "$SNAPSHOT.part" "$SNAPSHOT"
    echo "✓ downloaded: $SNAPSHOT"
    ;;
  import)
    prepare
    [ -f "$SNAPSHOT" ] || { echo "No snapshot yet: run '$0 download' first." >&2; exit 1; }
    "$engine" rm -f "$NAME" >/dev/null 2>&1 || true
    # The data belongs to the container's user
    "$engine" run --rm -v "$HOME_DIR":/data:Z --entrypoint "" "$IMAGE" rm -rf /data/data 2>/dev/null || "$engine" unshare rm -rf "$HOME_DIR/data"
    "$engine" run --rm -v "$HOME_DIR":/data:Z -w /data "$IMAGE" bootstrap snapshot --file /data/snapshots/preprod-ledger.tar.gz
    echo "✓ imported; start the node with '$0 up'"
    ;;
  mithril)
    # The other way to start: every block up to a few hours ago, from Mithril's certified copy of the chain. A much
    # bigger download (about 20 GB on disk, kept in snapshots/mithril) but the node then starts next to the tip
    # instead of months behind. Interrupted, it continues from the files already there when run again.
    prepare
    "$engine" rm -f "$NAME" >/dev/null 2>&1 || true
    "$engine" run --rm --name "$NAME-bootstrap" -v "$HOME_DIR":/data:Z -w /data "$IMAGE" bootstrap --force mithril --download-dir /data/snapshots/mithril --retain-snapshot
    echo "✓ bootstrapped from Mithril; start the node with '$0 up'"
    ;;
  up)
    prepare
    [ -d "$HOME_DIR/data" ] || { echo "No data yet: run '$0 download' and '$0 import' first." >&2; exit 1; }
    "$engine" rm -f "$NAME" >/dev/null 2>&1 || true
    "$engine" run -d --name "$NAME" --restart unless-stopped -p 50051:50051 -v "$HOME_DIR":/data:Z -w /data "$IMAGE" daemon >/dev/null
    echo "✓ $NAME is running: UTxO RPC on localhost:50051"
    ;;
  down)
    "$engine" rm -f "$NAME" >/dev/null 2>&1 || true
    echo "✓ stopped; its data stays in $HOME_DIR/data"
    ;;
  logs) exec "$engine" logs -f --tail 50 "$NAME" ;;
  status)
    "$engine" ps --filter "name=$NAME" --format "{{.Names}}  {{.Status}}" | grep . || echo "$NAME is not running"
    [ -f "$SNAPSHOT.part" ] && echo "snapshot: downloading, $(du -h "$SNAPSHOT.part" | cut -f1) so far"
    [ -f "$SNAPSHOT" ] && echo "snapshot: $(du -h "$SNAPSHOT" | cut -f1)"
    [ -d "$HOME_DIR/data" ] && echo "data:     $("$engine" unshare du -sh "$HOME_DIR/data" 2>/dev/null | cut -f1)"
    if "$engine" container exists "$NAME" 2>/dev/null; then "$engine" logs --tail 5 "$NAME" 2>&1 | sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g'; fi
    ;;
  *)
    sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
