# Simulation Portal

A local web app that runs the real Icarus Verilog testbench and shows what happened: results, FSM path, cache lines,
access trace and waveform. Five pages share one selected run: **Simulation, Cache Viewer, Waveform, Access Trace, Learn**.
Everything shown is read from the VCD that the testbench wrote for that run, or from the RTL source text. Nothing is
sample data. (UI layout and look follow the supplied *cache_controller_portal_ui_package* mockups; the numbers in those
images were placeholders and are not used.)

## Start it (macOS)
Requirements: Icarus Verilog (`brew install icarus-verilog`) and Python 3. No `pip install` is needed.

```bash
make portal
```
This starts the backend and opens <http://127.0.0.1:8765/> in your browser. Leave the Terminal window open while you use
the portal; press Ctrl-C to stop it. You can also double-click **Start Portal.command** in Finder.
If the page says *the simulation backend is not running*, the server is not started (or was stopped): run `make portal` again;
the page reconnects by itself.

## Five-step demo
1. **Simulation** page: choose *Direct-Mapped Conflict Miss*, latency 4, press **Run Simulation**. A progress bar shows
   *compiling* then *simulating*; then the results cards, FSM, cache snapshot, mini waveform and trace fill in.
2. Look at the **FSM**: the cloud-shaped states on the recorded path are highlighted and numbered. The text under it says
   why (for example "line #0 held tag 0x0, request tag was 0x1, so MISS_REQ → WAIT_MEM → REFILL").
3. Click a row in **Access Trace**. Every other page now points at that access. **View cache line** opens the Cache Viewer
   on that line; **View waveform** moves the waveform cursor to that access.
4. **Waveform**: scroll to zoom, drag to pan, click to place the cursor, ← → to step one clock, ⏮ ◀ ▶ ⏭ to jump between
   accesses. **Download VCD** (top bar) gives the original file for GTKWave.
5. **Learn**: tabs explain the architecture using the real configuration and, on *Performance*, the numbers measured in your run.

## Pages
| Page | What it shows | Source of the data |
|---|---|---|
| Simulation | Controls, results cards (accesses, hits, misses, hit rate, AMAT, cycles, memory transactions), address decoder, FSM, cache snapshot, mini waveform and trace | Backend run record + VCD trace |
| Cache Viewer | 64-line table (valid, tag, 16 data bytes), search and valid/invalid filter, selected-line details, byte grid | Cache contents rebuilt from the VCD at a chosen time |
| Waveform | 30 signals in collapsible groups, value at cursor, hex/binary/decimal/raw-bit display, state timeline, trace info | VCD (served in small windows) |
| Access Trace | Table of every CPU access (cycle, address, tag, index, offset, hit/miss, FSM transition), filters, search, paging, summary, H/M/E sequence, CSV/JSON export | VCD |
| Learn | Overview, cache basics, address mapping (interactive), FSM design, cache line format, Verilog tips, performance | RTL source text and the selected run |

## How the numbers are obtained
- **Access trace.** An access is accepted on a rising clock edge where `req_valid` and `req_ready` were both 1 just before
  the edge (and `rst_n` was 1). Its response is the next edge where `resp_valid` was 1; hit, miss or error comes from
  `resp_hit` / `resp_err`; the FSM path is read from `dut.state` at the edges in between.
- **Metrics.** Hit rate = hits ÷ (hits + misses) (error responses excluded). *Hit time* is the measured average latency of
  hits, *miss penalty* is (measured miss latency − hit time), and **AMAT = hit time + miss rate × miss penalty**; the average
  latency is also measured directly and the two agree. When a scenario has no hits (for example the conflict test) a separate
  hit time is not available, and the page says so.
- **Cache contents.** A VCD cannot hold RAM arrays, so lines are rebuilt from signals that are in the VCD: a line is written
  on the first clock edge after `dut.refill_en` rises (using `q_index`, `q_tag`, `refill_block`) and all valid bits clear on a
  clock edge where `rst_n` is low. `make verify-portal` checks every reconstructed line against the memory image.
- **Configuration** (1 KB, 16 B blocks, 64 lines, tag/index/offset widths, FSM names and encodings, counter count) is parsed
  from `rtl/cache_controller.v`, not hard-coded in the page.
- The full-suite waveform ends with `x` values: the testbench switches dumping off before test 10 (`$dumpoff`) to keep that
  file small. It is not a design fault.

## Safety
The browser sends only a scenario id and a latency. Both are checked against fixed lists (13 scenarios; latency 1, 2, 4, 8, 16).
Commands are fixed argument lists run without a shell, with timeouts. Run ids must match a strict pattern and exist in the
server's own list; static files come only from `portal/static/`; request bodies over 1 KB are refused; the server listens on
127.0.0.1 only. *Delete run* removes only that run's folder under `results/portal_runs/` (after a confirmation).

## Check that it is honest
```bash
make verify-portal
```
For seven real runs this checks: VCD written by Icarus Verilog and matches its SHA-256; the portal's indexed values equal an
independent re-parse of the VCD; the access trace equals a second, independent derivation (time, address and hit/miss/error
of every access); trace totals equal the counters the simulator printed; latencies match the design timing; FSM paths are
consistent; reconstructed cache lines match memory; CSV/JSON export belong to the run; asynchronous runs and delete work; and
bad scenarios, latencies, malformed JSON, oversized bodies, path traversal and unknown run ids are rejected.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Red banner "backend is not running" | Run `make portal` in the project folder (or double-click `Start Portal.command`). |
| `iverilog: command not found` in the results | `brew install icarus-verilog`. |
| `Port 8765 is in use by another program` | `lsof -i :8765`, stop that process, or `pkill -f portal/server.py` and start again. |
| "That run no longer exists" | The run folder was deleted (for example by `make clean`). Start a new simulation. |
| A big run (5000 requests, about 20 MB VCD) takes a few seconds the first time | The backend parses the VCD once; later requests are instant. |
| GTKWave | `brew tap homebrew/cask && brew install --cask gtkwave`, then open the downloaded `.vcd`. |
| Browser console shows `Failed to load resource` while the server is stopped | The browser reports failed requests itself; the page stops requesting and retries with increasing delays until the server is back. |

## Limitations
Only the listed testbench scenarios can run (custom Verilog cannot be submitted, by design). The VCD holds 30 indexed signals plus
everything else for GTKWave. Cache contents are reconstructed, not dumped. Only one simulation runs at a time. Synchronization
between the trace and the waveform is exact because both come from the same VCD timestamps.
