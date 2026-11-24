# Shared helpers for the simulation scripts (sourced, not executed).
cd "$(dirname "${BASH_SOURCE[0]}")/.."
LOGS=simulation/logs; WAVES=simulation/waveforms
mkdir -p "$LOGS" "$WAVES"
RTL=(rtl/*.v)
TB_SRC=(testbench/main_memory_model.v testbench/reference_memory.v testbench/tb_cache_controller.v)
# test number -> name (must match begin_test() in testbench/tb_cache_controller.v)
TEST_NAMES=("" cold_miss repeated_access same_block_accesses direct_mapped_conflict different_cache_lines
            sequential_access reset memory_latency request_handshake randomized boundary_and_errors conflict_100_1124_104)
quiet() { grep -v -e "timescale" -e "time unit" -e "Affected design" -e "-- module" -e "time precision" || true; }
# build_tb LAT DELAY OUTFILE : compile the system testbench with memory latency LAT and request back-pressure DELAY
build_tb() {
  iverilog -g2012 -Wall -I testbench -Ptb_cache_controller.LAT="$1" -Ptb_cache_controller.ACCEPT_DELAY="$2" \
      -o "$3" "${RTL[@]}" "${TB_SRC[@]}" 2>&1 | quiet
  return "${PIPESTATUS[0]}"
}
# resolve_test NAME_OR_NUMBER -> prints test number (0 = all); returns 1 if unknown
resolve_test() {
  case "$1" in
    all) echo 0; return 0 ;;
    conflict_miss|conflict) echo 4; return 0 ;;
    cold|miss) echo 1; return 0 ;;
    hit) echo 2; return 0 ;;
    brief_conflict|conflict_100_1124) echo 12; return 0 ;;
  esac
  if [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 12 ]; then echo "$1"; return 0; fi
  for i in $(seq 1 12); do [ "${TEST_NAMES[$i]}" = "$1" ] && { echo "$i"; return 0; }; done
  return 1
}

# ---- unit tests: one testbench per module (testbench/tb_<name>.v)
UNITS=(address_decoder tag_comparator hit_miss_unit storage)
unit_rtl() {
  case "$1" in
    storage) echo "rtl/cache_data_ram.v rtl/cache_tag_ram.v rtl/cache_valid_ram.v" ;;
    *)       echo "rtl/$1.v" ;;
  esac
}
# build_unit NAME : compile testbench/tb_NAME.v with its RTL into $LOGS/tb_NAME.vvp
build_unit() {
  iverilog -g2012 -Wall -o "$LOGS/tb_$1.vvp" $(unit_rtl "$1") "testbench/tb_$1.v" 2>&1 | quiet
  return "${PIPESTATUS[0]}"
}
