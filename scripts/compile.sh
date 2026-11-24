#!/bin/bash
# Compile everything with Icarus Verilog (-Wall) and elaborate the RTL with Yosys. No simulation is run.
# Usage: scripts/compile.sh      Exit status is nonzero if any compile or Yosys check fails.
set -u
source "$(dirname "$0")/common.sh"
status=0
echo "== RTL lint (iverilog -Wall) =="
iverilog -g2012 -Wall -o /dev/null "${RTL[@]}" 2>&1 | quiet; [ "${PIPESTATUS[0]}" -ne 0 ] && status=1
echo "== RTL elaboration (yosys proc; check -assert) =="
yosys -q -p "read_verilog -sv ${RTL[*]}; hierarchy -check -top cache_controller; proc; check -assert" || status=1
echo "== testbenches =="
for u in "${UNITS[@]}"; do build_unit "$u" || { echo "unit testbench $u failed to compile"; status=1; }; done
build_tb 4 0 $LOGS/tb_cache_lat4.vvp || status=1
[ $status -eq 0 ] && echo "COMPILE OK" || echo "COMPILE FAILED"
exit $status
