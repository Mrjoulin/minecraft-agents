#!/usr/bin/env bash
# Runs the local server; commands can be piped in through server/console.fifo.
set -euo pipefail
cd "$(dirname "$0")/../server"
[ -p console.fifo ] || mkfifo -m 600 console.fifo
tail -f console.fifo | java -Xmx3G -jar server.jar nogui > server.log 2>&1
