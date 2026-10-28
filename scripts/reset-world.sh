#!/usr/bin/env bash
# Stops the server, restores the pristine world backup. Start the server again with scripts/start-server.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$ROOT/server"
if pgrep -f "java .*server.jar" >/dev/null; then
  echo "stop" > "$SERVER/console.fifo"
  for _ in $(seq 1 30); do pgrep -f "java .*server.jar" >/dev/null || break; sleep 1; done
fi
pkill -f "tail -f console.fifo" || true
rm -rf "$SERVER/world"
cp -R "$ROOT/world-backup" "$SERVER/world"
echo "World restored from backup."
