#!/usr/bin/env bash
# Runs the server; console commands arrive through server/console.in (a plain file that
# scripts append to and this script tails into the server's stdin — named pipes don't work
# between MSYS and native processes on Windows).
set -euo pipefail
cd "$(dirname "$0")/../server"
rm -f console.in
touch console.in
tail -f console.in | java -Xmx3G -jar server.jar nogui > server.log 2>&1
