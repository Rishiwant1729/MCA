#!/bin/bash
# Full regression: unit tests; system testbench at latency 1/2/4/8/16; memory back-pressure
# (ACCEPT_DELAY 1 and 3); alternative random seeds. Writes simulation/logs/regression_summary.txt.
# Usage: scripts/regression.sh     Exit status is nonzero if any run fails.
set -u
source "$(dirname "$0")/common.sh"
SUM=$LOGS/regression_summary.txt; : > $SUM; status=0; total=0; failed=0
note() { echo "$@" | tee -a $SUM; }
note "Regression $(date '+%Y-%m-%d %H:%M:%S')  ($(iverilog -V 2>/dev/null | head -1))"
scripts/compile.sh > /dev/null 2>&1 || { note "COMPILE FAILED (run: make compile)"; exit 1; }
for u in "${UNITS[@]}"; do
  vvp -n $LOGS/tb_$u.vvp > $LOGS/unit_$u.log; rc=$?; total=$((total+1))
  [ $rc -ne 0 ] && { failed=$((failed+1)); note "FAIL unit $u"; } || note "PASS unit $u  ($(grep "tb_$u:" $LOGS/unit_$u.log))"
done
run_cfg() {  # label LAT DELAY SEED
  local tag="lat$2_delay$3_seed$4" exe
  exe=$LOGS/reg_$tag.vvp
  iverilog -g2012 -I testbench -Ptb_cache_controller.LAT=$2 -Ptb_cache_controller.ACCEPT_DELAY=$3 -Ptb_cache_controller.SEED=$4 \
      -o $exe "${RTL[@]}" "${TB_SRC[@]}" 2>&1 | quiet
  vvp -n $exe > $LOGS/reg_$tag.log; rc=$?; total=$((total+1))
  if [ $rc -ne 0 ]; then failed=$((failed+1)); note "FAIL $1  (LAT=$2 ACCEPT_DELAY=$3 SEED=$4)  log: $LOGS/reg_$tag.log"
  else note "PASS $1  (LAT=$2 ACCEPT_DELAY=$3 SEED=$4)  $(grep '^SUMMARY' $LOGS/reg_$tag.log)"; fi
  rm -f $exe
}
for L in 1 2 4 8 16; do run_cfg "latency" $L 0 1; done
for D in 1 3; do run_cfg "back-pressure" 1 $D 1; run_cfg "back-pressure" 4 $D 1; done
for S in 2 3 4; do run_cfg "random seed" 4 0 $S; done
note "----"
note "$((total-failed)) of $total regression runs passed"
[ $failed -eq 0 ] && { note "REGRESSION PASS"; exit 0; } || { note "REGRESSION FAIL"; exit 1; }
