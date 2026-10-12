#!/bin/bash
# Double-click to run Study on this Mac at http://localhost:5173
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Download the LTS version from https://nodejs.org, install it, then double-click this again."
  read -n 1 -s -r -p "Press any key to close"
  exit 1
fi
node scripts/start.mjs
read -n 1 -s -r -p "Stopped. Press any key to close"
