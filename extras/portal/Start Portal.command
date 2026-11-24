#!/bin/bash
# Double-click in Finder to start the simulation portal (opens your browser).
cd "$(dirname "$0")/../.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v iverilog >/dev/null 2>&1; then
  echo "Icarus Verilog not found. Install it with:  brew install icarus-verilog"
  read -r -p "Press Enter to close..." _
  exit 1
fi
python3 extras/portal/server.py
