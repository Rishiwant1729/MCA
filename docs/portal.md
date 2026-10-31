# Simulation Portal and Waveform Viewer

A local web page that runs the real testbench with Icarus Verilog and shows the resulting waveform.
It is an addition to the hardware project, not a replacement for any test: everything it shows is read back from a VCD
file written by `$dumpfile`/`$dumpvars` in the testbench.

## Start it (macOS)
Requirements: the tools from the README (Icarus Verilog) and Python 3 (standard library only; no `pip install` needed).
```bash
make portal            # or: python3 portal/server.py
```
Open <http://127.0.0.1:8765/> in a browser. Stop with Ctrl-C. The server listens on `127.0.0.1` only.

## Using it
1. **Pick a scenario and latency**, press *Compile & run*. Scenarios are the 11 testbench tests (T1–T11), the full suite
   (waveform covers T1–T9) and a 5000-request random run that produces a large (~20 MB) VCD.
2. **Results** show compiler messages (if any), each test's expected vs actual line, PASS/FAIL, the exact commands run and
   a link to the raw simulation log. A compile error or a failing test is shown as such; a failing run still loads
   whatever waveform it produced.
3. **Waveform**: the banner above it names the run (id, scenario, latency, time, design hash, VCD path, size, sha256).
   - Zoom: mouse wheel, ＋/－, keys `+`/`-`; fit: *Fit* or `0`.
   - Pan: drag, ◀/▶, shift+wheel, or the slider under the waveform.
   - Cursor: click the waveform or drag in the time ruler; `←`/`→` step one clock (shift: ten clocks) when the waveform has focus.
   - Signals: use *Signals* to show or hide any of the 30 signals; click a group header to collapse or expand it.
     The values at the cursor are shown beside each name.
   - Buses are drawn as labelled segments in hex, binary or decimal (*Radix*); FSM states are shown by name.
     Red hatching means the simulator wrote `x` (unknown/uninitialized).
4. **Synchronized views** follow the cursor: the controller FSM diagram highlights the state at that time and shows the
   latched address split into tag/index/offset, hit/miss and counters; the cache-line table shows each line's valid bit,
   tag and data at that time (the line most recently refilled is highlighted, the line being accessed has an orange marker).
5. **Download VCD** gives the original, unmodified file. *Copy GTKWave command* copies
   `open -a gtkwave results/portal_runs/<run>/wave.vcd`.

Runs are stored in `results/portal_runs/<run_id>/` (`wave.vcd`, `sim.log`, `meta.json`, `sim.vvp`) and listed under *Previous runs*.

### Where the displayed data comes from
- **Waveforms**: the backend parses the run's `wave.vcd` and serves only the visible time window. Dense windows are reduced to
  the first and last change per pixel column (marked as dense); zooming in shows every transition.
- **FSM view**: the value of `dut.state` from the VCD at the cursor time.
- **Cache-line table**: the testbench cannot dump memory arrays to a VCD, so the table is *rebuilt from signals that are in
  the VCD*: a line is written on the first clock edge after `dut.refill_en` rises, using the dumped `q_index`, `q_tag` and
  `refill_block`; all valid bits clear on a clock edge where `rst_n` is low. `scripts/verify_portal.py` checks every
  reconstructed line against the memory image.
- **The `x` at the end of the full-suite waveform** is how `$dumpoff` records that dumping was switched off before T10
  (to keep that VCD small). It is not a design fault.

## Safety model
- The browser sends only a scenario id and a latency. The backend accepts ids from a fixed table and latencies from
  `[1, 2, 4, 8, 16]`; anything else is rejected (HTTP 400). No command text, file path or file name comes from the browser.
- Commands are fixed argument lists (`iverilog …`, `vvp …`) run without a shell, in the project directory, with
  timeouts (compile 120 s, simulation 300 s). Output is size-limited.
- Run ids must match `run_YYYYMMDD_HHMMSS_N` **and** be known to the server; static files are served only from `portal/static/`.
- Request bodies over 1 KB are refused. The server binds to localhost only.
- Heavy work stays on the backend: the browser requests small windows of data, so a 20 MB VCD does not freeze the page.

## Verifying that waveforms are real
```bash
make verify-portal          # python3 scripts/verify_portal.py
```
For five runs (including the full suite and a 300-request random run) it checks: the VCD was written by Icarus Verilog and
its sha256 matches the run record; the portal's indexed values equal an independent re-parse of the VCD at 400 random times
for all 30 signals; the VCD's counters and `resp_valid` pulse count equal the numbers the simulator printed in its own log;
reconstructed cache lines match the memory image; the download is byte-identical to the file on disk; and that bad scenarios,
latencies, malformed or oversized JSON, path traversal and unknown run ids are rejected.

## Troubleshooting (macOS)
| Symptom | Fix |
|---|---|
| `iverilog: command not found` in the results panel | `brew install icarus-verilog`. The server adds `/opt/homebrew/bin` and `/usr/local/bin` to its PATH; run `which iverilog` to confirm where it is. |
| `OSError: [Errno 48] Address already in use` | Another server is on port 8765: `lsof -i :8765`, then stop it (or `pkill -f portal/server.py`). |
| Page says “Portal failed to start” | The server is not running; start `make portal` and reload. |
| “Waveform load failed” / long wait on a big run | The first request for a run parses the VCD (a 20 MB file takes a few seconds). Retry after the spinner finishes. |
| Compile error shown in Results | A real error in `rtl/` or `sim/`; the message is the Icarus output. Fix the file and run again. |
| GTKWave does not open | Install it with `brew tap homebrew/cask && brew install --cask gtkwave` and open the downloaded `.vcd`; on first launch macOS may ask you to allow the app in System Settings → Privacy & Security. |
| Old runs clutter the list | `make clean` removes `results/portal_runs/`. |

## Limitations
- Only the cache testbench scenarios listed above can be run; custom Verilog cannot be submitted (by design).
- Only 30 signals are indexed in the browser view; the VCD itself contains all testbench and DUT signals for GTKWave.
- Cache contents are reconstructed, not dumped; arrays inside RAM modules are not in the VCD.
- Multiple simultaneous runs are serialized by a lock.
