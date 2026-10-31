#!/bin/bash
# Yosys synthesis of the cache controller (software estimates only; no FPGA hardware involved).
#   Flow 1 "generic": technology-independent gates. Memories become flip-flops + muxes
#                     (what a design with no RAM macros would cost).
#   Flow 2 "ice40"  : maps to Lattice iCE40 primitives (LUT4, DFF, SB_RAM40_4K block RAM)
#                     so RAM inference shows up. Used only as a representative FPGA resource model.
# Logs and statistics go to results/synthesis/. Exit status nonzero if Yosys fails.
set -eu
cd "$(dirname "$0")/.."
OUT=results/synthesis; mkdir -p $OUT
READ="read_verilog -sv rtl/address_decoder.v rtl/cache_data_ram.v rtl/cache_tag_ram.v rtl/cache_valid_ram.v rtl/main_memory_interface.v rtl/cache_controller.v; hierarchy -check -top cache_controller"

echo "== generic flow (hierarchical statistics) =="
yosys -l $OUT/generic.log -p "$READ; synth -top cache_controller; check -assert; tee -o $OUT/generic_stat.txt stat" > /dev/null
echo "== generic flow (flat) =="
yosys -l $OUT/generic_flat.log -p "$READ; synth -top cache_controller -flatten; check -assert; tee -o $OUT/generic_flat_stat.txt stat" > /dev/null
echo "== iCE40 flow =="
yosys -l $OUT/ice40.log -p "$READ; synth_ice40 -top cache_controller -json $OUT/ice40.json; tee -o $OUT/ice40_stat.txt stat" > /dev/null

echo "== iCE40 flow (hierarchy kept, for per-module numbers) =="
yosys -l $OUT/ice40_hier.log -p "$READ; synth_ice40 -top cache_controller -noflatten; tee -o $OUT/ice40_hier_stat.txt stat" > /dev/null

echo "Warnings (excluding ABC's harmless 'network is combinational' notes):"
grep -h -i "warning" $OUT/generic.log $OUT/generic_flat.log $OUT/ice40.log $OUT/ice40_hier.log | grep -v "network is combinational" | sort | uniq -c || echo "  none"
echo "Reports: $OUT/*_stat.txt"
