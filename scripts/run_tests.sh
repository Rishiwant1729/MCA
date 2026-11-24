#!/bin/bash
# Quick check: unit tests plus the full system testbench (all 12 tests) at one memory latency.
# Usage: scripts/run_tests.sh [LAT]        (default LAT=4)   Exit status is nonzero if anything fails.
set -u
source "$(dirname "$0")/common.sh"
L=${1:-4}; status=0
scripts/compile.sh > /dev/null 2>&1 || { echo "compile failed; run: make compile"; exit 1; }
for u in address_decoder storage; do
  vvp -n $LOGS/tb_$u.vvp > $LOGS/unit_$u.log; rc=$?
  grep "tb_$u:" $LOGS/unit_$u.log; [ $rc -ne 0 ] && status=1
done
build_tb "$L" 0 $LOGS/tb_cache_lat$L.vvp || { echo "compile failed"; exit 1; }
vvp -n $LOGS/tb_cache_lat$L.vvp > $LOGS/tb_cache_lat$L.log; rc=$?
grep -E "^  T[0-9]+ |^SUMMARY" $LOGS/tb_cache_lat$L.log; [ $rc -ne 0 ] && status=1
echo "log: $LOGS/tb_cache_lat$L.log"
[ $status -eq 0 ] && echo "TEST PASS" || echo "TEST FAIL"
exit $status
