# Synthesis Report (Yosys, software estimates)

Reproduce: `scripts/run_synthesis.sh` (about 15 s). Raw logs and statistics: `results/synthesis/`.
Tool: Yosys 0.70. Top module: `cache_controller` (1 KB, 16 B blocks, 64 lines, 32-bit address, default parameters).

**These are synthesis estimates from a software flow. Nothing here was placed, routed, or run on an FPGA or ASIC,
and no clock frequency is claimed.** The FPGA numbers use the Lattice iCE40 cell library only as a representative
resource model; the design was not targeted at a specific board.

## Result 1: FPGA-style mapping (`synth_ice40`, flat) — `results/synthesis/ice40_stat.txt`
| resource | count |
|---|---|
| SB_LUT4 (logic) | 635 |
| SB_CARRY | 230 |
| Flip-flops (SB_DFF*) | 487 |
| SB_RAM40_4K (4 Kbit block RAM) | 18 |

Memory inference: Yosys mapped all 17 storage arrays to block RAM (16 data byte lanes + the tag RAM, which needs 2
blocks for its 22-bit width) and the log shows each one mapped via `$__ICE40_RAM4K_`. The valid bits are 64 flip-flops
by design (they must clear in one cycle on reset).

Observations:
- **Block RAM is under-used.** The design stores 8192 data bits + 1408 tag bits, but 18 blocks provide 73,728 bits. Each
  64-entry × 8-bit lane occupies a whole block. This is a consequence of the small cache and the byte-lane structure;
  a design that only needs word-granular writes could pack the data into fewer, wider blocks.
- **Flip-flop count is dominated by non-storage state.** The 487 flip-flops are consistent with: seven 32-bit statistics
  counters (224), the 128-bit refill block register and 32-bit address register in `main_memory_interface` (160),
  64 valid bits + 1, the 32-bit latched request address, and a few state bits. The statistics counters alone cost
  about half of all flip-flops and 225 of the 230 carry cells. They are for measurement; a production version would
  make them optional.

## Result 2: technology-independent gates (`synth`, flat) — `results/synthesis/generic_flat_stat.txt`
| item | count |
|---|---|
| Total cells | 26,160 |
| Flip-flops (`$_DFF*`) | 10,237 |
| `$_MUX_` | 7,102 |
| AND/NAND/OR/NOR/XOR/etc. | remainder |

Without RAM blocks, Yosys turns the storage into flip-flops and read multiplexers: about 9,600 of the flip-flops are
the data and tag arrays (8192 + 1408 bits). This is the cost of building the cache from registers, and it explains
why RAM inference matters: the same design needs 487 flip-flops plus 18 RAM blocks in Result 1.

Hierarchy (`generic_stat.txt`, cells including submodules): data RAM ≈ 22,030 of 27,516 total (80%), tag RAM 3,687,
valid bits 537, memory interface 179. (The hierarchical total differs slightly from the flat total because flattening
allows cross-module optimization.)

## Warnings and unsupported constructs
- RTL: no warnings. `iverilog -Wall` and Yosys `check -assert` are clean (`make lint`). No latches inferred
  (`next_state` is fully assigned), no unsupported constructs.
- Yosys prints a "SystemVerilog keyword `bit`" lexer warning that comes from Yosys's own `abc9_map.v` library file, not from this project.
- ABC prints "network is combinational" notes; they are informational.
- Fixed during this phase: the first data-RAM coding style (one wide array written by a per-byte loop) had 16 write
  ports and was not mappable to RAM; it synthesized to ~9,750 flip-flops even in the FPGA flow. It was rewritten as one
  RAM per byte lane, and the full test suite was re-run after the change (all pass at LAT = 1, 2, 4, 8, 16).
- Hierarchical iCE40 statistics (`ice40_hier_stat.txt`, `-noflatten`) show larger per-module flip-flop counts than the flat
  run, because module boundaries block optimization. Use the flat numbers as the design total.

## Timing
No timing analysis was done. A valid timing flow would need place-and-route (for example nextpnr), a target device and
clock constraints; none were used, and Yosys's `stat` gives no delay. The critical path is expected to be the tag
compare → hit decision → next-state/response path, but that is a design expectation, not a measurement.
