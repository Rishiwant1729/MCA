#!/bin/bash
# Generate a VCD for one test (complete timing, nothing trimmed). Open it with GTKWave.
# Usage: scripts/run_wave.sh <test> [LAT] [ACCEPT_DELAY]
#   <test>: a name (cold_miss, repeated_access, same_block_accesses, direct_mapped_conflict, different_cache_lines,
#           sequential_access, reset, memory_latency, request_handshake, randomized, boundary_and_errors,
#           conflict_100_1124_104), a number 1-12, an alias (conflict_miss), or "all" (whole suite, large file).
# Output: results/waveforms/<test>_lat<LAT>.vcd and results/simulation_logs/wave_<test>_lat<LAT>.log
set -u
source "$(dirname "$0")/common.sh"
T=${1:-}; L=${2:-4}; D=${3:-0}
if [ -z "$T" ] || ! N=$(resolve_test "$T"); then
  [ -n "$T" ] && echo "unknown test: $T"
  echo "usage: make wave TEST=<name> [LAT=4]"; echo "tests:"; for i in $(seq 1 12); do printf "  %2d  %s\n" $i "${TEST_NAMES[$i]}"; done; echo "   0  all"
  exit 2
fi
NAME=$([ "$N" = 0 ] && echo all || echo "${TEST_NAMES[$N]}")
EXE=$LOGS/wave_$NAME.vvp; VCD=$WAVES/${NAME}_lat$L.vcd; LOG=$LOGS/wave_${NAME}_lat$L.log
build_tb "$L" "$D" "$EXE" || { echo "compile failed"; exit 1; }
vvp -n "$EXE" +test=$N +vcd=$VCD +fulldump > "$LOG"; rc=$?
rm -f "$EXE"
grep -E "^\[T|^SUMMARY|result" "$LOG"
if [ $rc -ne 0 ]; then echo "test FAILED (see $LOG)"; exit 1; fi
echo "waveform: $VCD ($(du -k "$VCD" | cut -f1) KB)   open with: gtkwave $VCD"
