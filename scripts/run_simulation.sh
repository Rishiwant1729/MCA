#!/bin/bash
# Runs unit tests and the full self-checking testbench at several memory latencies.
# Usage: scripts/run_simulation.sh [latency ...]     (default: 1 2 4 8 16)
# Exit status is nonzero if any run fails. Logs: results/simulation_logs/, waveform: results/waveforms/
set -u
cd "$(dirname "$0")/.."
LOGS=results/simulation_logs; mkdir -p "$LOGS" results/waveforms
LATS=("$@"); [ ${#LATS[@]} -eq 0 ] && LATS=(1 2 4 8 16)
RTL=(rtl/*.v); status=0
quiet() { grep -v -e "timescale" -e "time unit" -e "Affected design" -e "-- module" -e "time precision" || true; }

echo "== unit tests =="
iverilog -g2012 -o $LOGS/tb_address_decoder.vvp rtl/address_decoder.v sim/unit/tb_address_decoder.v 2>&1 | quiet
vvp -n $LOGS/tb_address_decoder.vvp > $LOGS/unit_address_decoder.log; rc=$?
grep "tb_address_decoder:" $LOGS/unit_address_decoder.log; [ $rc -ne 0 ] && status=1
iverilog -g2012 -o $LOGS/tb_storage.vvp rtl/cache_data_ram.v rtl/cache_tag_ram.v rtl/cache_valid_ram.v sim/unit/tb_storage.v 2>&1 | quiet
vvp -n $LOGS/tb_storage.vvp > $LOGS/unit_storage.log; rc=$?
grep "tb_storage:" $LOGS/unit_storage.log; [ $rc -ne 0 ] && status=1

echo "== full testbench =="
for L in "${LATS[@]}"; do
  iverilog -g2012 -I sim -Ptb_cache_controller.LAT=$L -o $LOGS/tb_cache_lat$L.vvp \
      "${RTL[@]}" sim/main_memory_model.v sim/reference_memory.v sim/tb_cache_controller.v 2>&1 | quiet
  extra=""; [ "$L" = "4" ] && extra="+dump"          # waveform evidence for LAT=4
  vvp -n $LOGS/tb_cache_lat$L.vvp $extra > $LOGS/tb_cache_lat$L.log; rc=$?
  printf "LAT=%-3s %s  (exit %d)\n" "$L" "$(grep '^SUMMARY' $LOGS/tb_cache_lat$L.log)" $rc
  [ $rc -ne 0 ] && status=1
done
[ $status -eq 0 ] && echo "ALL PASS" || echo "SOME TESTS FAILED"
exit $status
