# Direct-Mapped Cache Controller (Modern Computer Architecture capstone)

A synthesizable Verilog direct-mapped cache controller (1 KB, 16-byte blocks, 64 lines, 32-bit addresses) with a
configurable-latency main-memory model, a self-checking testbench, measured performance statistics, and Yosys synthesis
results. **Everything here is software simulation/synthesis on macOS; nothing was run on physical hardware.**

Status: **read-only cache (milestone 1) complete and verified.** Write support (write-through, write-allocate) is a planned extension, not implemented.

## Setup (macOS, Homebrew)
```bash
brew install icarus-verilog yosys graphviz
brew tap homebrew/cask && brew install --cask gtkwave      # optional: interactive waveform viewer
python3 -m venv .venv && .venv/bin/pip install matplotlib   # plots
```
Verify the toolchain:
```bash
iverilog -V | head -1 && yosys -V && dot -V && make smoke
```
Tested with Icarus Verilog 13.0, Yosys 0.70, Python 3.14, matplotlib 3.11.

## Commands
| Command | What it does |
|---|---|
| `make smoke` | toolchain check (tiny counter simulation) |
| `make lint` | `iverilog -Wall` on all RTL + Yosys elaboration/check |
| `make sim` | unit tests + 11-test self-checking testbench at memory latency 1, 2, 4, 8, 16; nonzero exit on failure |
| `make perf` | workload traces → simulation → `results/performance/*.csv` and plots |
| `make synth` | Yosys generic and iCE40-style synthesis → `results/synthesis/` |
| `make portal` | web portal: run a test scenario, view its real waveform, FSM and cache lines at the cursor (http://127.0.0.1:8765/) |
| `make verify-portal` | proves portal waveforms come from real simulation runs and tests the backend's input validation |
| `make waves` | regenerate the timing diagram and block/FSM diagrams |
| `make all` | everything above |

View a waveform: `open -a gtkwave results/waveforms/tb_cache_lat4.vcd` (the `test_no` signal shows which test is running).

## Web portal
```bash
make portal
```
Opens <http://127.0.0.1:8765/> (leave the Terminal window open; Ctrl-C stops it; or double-click `Start Portal.command`).
Five pages (Simulation, Cache Viewer, Waveform, Access Trace, Learn) share one selected run. Pick a scenario, press **Run Simulation**,
and inspect the real results, FSM path, cache lines, access trace and VCD waveform; **Download VCD** opens in GTKWave.
Details, how each number is obtained, safety model and troubleshooting: [docs/portal.md](docs/portal.md).

## IEEE report
`report/Direct_Mapped_Cache_Controller_IEEE_Report.pdf` (source `report/main.tex`, IEEEtran class) is the single project report: Abstract, Introduction,
Literature Review, Proposed Solution (with diagrams), Implementation and Verification, Results (waveforms, performance, synthesis, portal screenshots),
Individual Contributions, Conclusion and References. `make report` regenerates the waveform figures from real runs and rebuilds the PDF
(needs `pdflatex`; install the class with `tlmgr --usermode install ieeetran`). Fill in the team names on the title page and in the
Individual Contributions table of `report/main.tex`.

## Layout
```
rtl/        synthesizable design (address_decoder, cache_data/tag/valid_ram, main_memory_interface, cache_controller)
sim/        simulation only: main_memory_model, reference_memory, tb_cache_controller, tb_perf, tb_integration, unit/, test_vectors/
portal/     server.py (local backend), vcd_index.py (VCD reader + access trace), static/ (five-page browser UI)
scripts/    run_simulation.sh, run_synthesis.sh, analyze_results.py, plot_waveform.py, verify_portal.py
results/    simulation_logs/, waveforms/, performance/, synthesis/   (generated)
docs/       architecture.md, fsm_design.md, portal.md, diagrams/   (design notes)
report/     the IEEE report: main.tex and Direct_Mapped_Cache_Controller_IEEE_Report.pdf
```

## Key results (all measured; see the docs for details)
- 11 directed/random tests pass at every latency tested; bug-injection check: 12 of 13 injected RTL bugs caught, the 13th is behaviorally equivalent (IEEE report, Section IV).
- Hit time 2 cycles; miss penalty LAT + 5 cycles. At LAT = 4: sequential 75% hit, repeated 99.8%, random 1.4%, conflict 0% (IEEE report, Section V).
- FPGA-style synthesis estimate: 635 LUT4, 487 flip-flops, 18 block RAMs (IEEE report, Section V). No timing analysis.

## Demonstration procedure (about 5 minutes)
1. `make smoke` — shows the toolchain works.
2. `make sim` — watch 5 latency runs print `SUMMARY: PASS (11/11 tests)`. Open `results/simulation_logs/tb_cache_lat4.log` to show each test's *expected* vs *actual* lines.
3. Show the diagrams in `docs/diagrams/` (block diagram, FSM, waveform of a miss followed by hits). Point out: LOOKUP → MISS_REQ → WAIT_MEM (LAT cycles) → REFILL → COMPLETE, then the next accesses finish in 2 cycles.
4. `make perf` — show the table and `results/performance/hit_miss_rate.png`; explain sequential = 25% misses (one per 4-word block) and conflict = 100% misses (addresses 0 and 1024 share a line).
5. Optional live bug: change `wire hit = rd_valid && (rd_tag == q_tag);` in `rtl/cache_controller.v` to drop `rd_valid &&`, run `make sim`, show FAIL and a nonzero exit, then revert.
6. `make portal` — run *T4 Direct-mapped conflict*, click along the waveform, and watch the FSM state and cache line 0 change as 0x0 and 0x400 evict each other; click *Download VCD*.
7. `make synth` — show `results/synthesis/ice40_stat.txt` (18 RAM blocks) and explain the estimate-vs-hardware distinction.

## Known limitations
Read-only; blocking (one request at a time); 32-bit word accesses only; memory model is always ready (back-pressure untested);
synthetic traces; synthesis numbers are estimates and there is no timing analysis; statistics counters are always
present (about half the flip-flops). Possible extensions: write-through/write-allocate, parameter sweeps of size and block
size, 2-way set-associative comparison, optional statistics counters, timing with place-and-route.
