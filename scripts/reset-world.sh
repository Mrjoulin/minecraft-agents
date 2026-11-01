#!/usr/bin/env bash
# Stops the server and deletes the world so the next start regenerates it from the
# fixed level-seed in server/server.properties (reproducible runs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$ROOT/server"
if pgrep -f "java .*server.jar" >/dev/null; then
  echo "stop" >> "$SERVER/console.in"
  for _ in $(seq 1 30); do pgrep -f "java .*server.jar" >/dev/null || break; sleep 1; done
fi
pkill -f "tail -f console.in" 2>/dev/null || true
rm -rf "$SERVER/world"
echo "World deleted; it will regenerate from level-seed=$(grep '^level-seed' "$SERVER/server.properties" | cut -d= -f2) on the next start."
