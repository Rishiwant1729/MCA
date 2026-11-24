# Synthesis

Tool: Yosys 0.70 (Homebrew). `make synth` runs the four flows in `synth/*.ys` and regenerates `results/synthesis/SUMMARY.md` from the
Yosys statistics (`scripts/synth_summary.py` parses them; no number is typed in). The `*_stat.txt` reports and `SUMMARY.md` are tracked;
the large `.log` and `ice40.json` files are generated and ignored by git.

**These are software synthesis estimates.** No place-and-route, no timing analysis and no hardware were involved, and no FPGA device was
selected. The iCE40 flow is a representative FPGA resource model chosen because Yosys can map block RAM for it.

## Flows
| Script | What it does |
|---|---|
| `synth/generic_hier.ys` | `synth -top cache_controller`, hierarchy kept: technology-independent gates, per-module statistics |
| `synth/generic_flat.ys` | same, flattened: whole-design statistics |
| `synth/ice40_flat.ys` | `synth_ice40`, flattened; RAM inferred as `SB_RAM40_4K`; also writes `ice40.json` |
| `synth/ice40_hier.ys` | `synth_ice40 -noflatten`: per-module numbers |

Every flow ends with `check -assert`, which fails the run on combinational loops, multiple drivers or undriven nets.

## Results (current `results/synthesis/SUMMARY.md`)
| Flow | Cells | Flip-flops | Logic | Block RAM |
|---|---|---|---|---|
| Generic, flat | 26160 | 10237 | 15917 combinational gates | none (memories become flip-flops and multiplexers) |
| iCE40, flat | 1376 | 487 | 635 LUT4 (+230 carry) | 18 x SB_RAM40_4K |

Per module (iCE40, hierarchy kept; larger than the flat total because cross-module optimisation is off):
data RAM 16 block RAMs, tag RAM 2 block RAMs, valid bits 64 flip-flops (not RAM, so one reset clears all), `main_memory_interface` 164
flip-flops (holds the 128-bit refill block), `cache_controller` 264 flip-flops.

## Interpretation
- **Memory structures.** The data array is mapped to 16 block RAMs, one per byte lane, and the tag array to 2. A first single-array version
  could not map to RAM because it had many write ports; the byte-lane form is the standard fix.
- **Generic flow.** It reports about 10k flip-flops because it has no RAM macro: the 64 x 128-bit data array and the tag array turn into
  registers. This is what the design would cost without RAM blocks, not a realistic FPGA number.
- **Statistics counters.** The seven 32-bit counters cost about half the flip-flops of the iCE40 design and are the likely source of the 230 carry
  cells (not isolated per module in these runs). They exist for measurement and could be made optional.
- **Latches and loops.** None inferred: `check -assert` passes in all four flows, and every state of the FSM has a defined next state.

## Warnings and limitations
- The Yosys logs contain a lexer warning about the SystemVerilog keyword `bit` in Yosys's own `abc9_map.v` helper, not in this
  project's RTL. ABC's "network is combinational" notes are filtered out of the summary. No unsupported construct was reported for the RTL.
- Only the synthesizable `rtl/` files are read; `sim/` models are never synthesized.
- No timing (no clock frequency is claimed), no power, no device-specific utilisation percentages.
