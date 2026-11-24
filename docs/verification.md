# Verification

All results below were produced by `make regression` and `make test` (Icarus Verilog 13.0). Logs: `simulation/logs/tb_cache_lat4.log`
(expected vs actual for every test, tracked in git) and `simulation/logs/regression_summary.txt` (last regression run).
Other logs are regenerated on demand and are not tracked.

## Method
Two independent layers run on every simulation (`testbench/tb_cache_controller.v`):

1. **Monitor.** At each accepted request it computes the expected word from `reference_memory` (a golden model separate from the
   simulated memory) and the expected hit/miss from a behavioural valid/tag model inside the testbench. Every response is checked
   (data, `resp_hit`, `resp_err`), together with protocol rules: exactly one response per request, none spurious, none before the
   memory data arrives for a miss, and no request accepted while one is outstanding.
2. **Directed tests.** Each test states its expectation in the log and checks it explicitly: hit/miss pattern, hit and miss
   latency in cycles, memory-read count, and the internal tag/valid/data contents (white-box reads of the RAM arrays).

A **memory-side protocol checker** also runs in every simulation:

| Rule | Checked |
|---|---|
| P1 | `mem_req_valid` stays high with a stable address until `mem_req_ready` accepts it |
| P2 | `mem_req_addr` is block aligned (low 4 bits zero) |
| P3 | no request is accepted while a read is outstanding (no duplicate transactions) |
| P4 | `mem_resp_valid` only while a read is outstanding, and for one cycle only |

At the end of every test `check_stats` also requires `stat_mem_reads == misses == memory bus reads`, so a stray repeated memory
request is reported as a failure.

A failed check prints `FAIL[...]`, the test is reported FAIL, the run ends with `SUMMARY: FAIL`, and the process exits non-zero
(`$fatal`). A watchdog stops runs that hang. A run is only PASS if all 12 tests ran and none failed.

## Tests (LAT = 4, seed 1; from `tb_cache_lat4.log`)

| # | Name | Expected | Actual | Result |
|---|---|---|---|---|
| 1 | cold_miss | invalid line -> miss; 1 block-aligned memory read; line installed; correct data | 17 checks, 1 req: 0 hit / 1 miss / 1 mem read | PASS |
| 2 | repeated_access | miss then hit; 1 memory read | 18 checks, 3 req: 2 hit / 1 miss | PASS |
| 3 | same_block_accesses | 4 words of one block: 1 miss then 3 hits | 21 checks, 4 req: 3 hit / 1 miss / 1 mem read | PASS |
| 4 | direct_mapped_conflict | addresses 0 and 1024 alternate: every access misses | 36 checks, 6 req: 0 hit / 6 miss | PASS |
| 5 | different_cache_lines | 64 blocks, one per line: 64 misses, then 64 hits | 399 checks, 130 req: 66 hit / 64 miss | PASS |
| 6 | sequential_access | 256 words: 1 miss per block (64 miss / 192 hit), second pass all hits | 1547 checks, 512 req: 448 hit / 64 miss | PASS |
| 7 | reset | reset clears valid bits and counters; stale tag/data never hit; reset during a miss is clean | 34 checks | PASS |
| 8 | memory_latency | miss = LAT+7 cycles, memory wait = LAT+4, hit = 2 | 18 checks: hit 2, miss 11, penalty 9 | PASS |
| 9 | request_handshake | requests held while busy accepted once each, in order; withdrawn requests never accepted | 57 checks, 82 req | PASS |
| 10 | randomized | 5000 seeded random reads (local, wide, conflict mix; idle gaps; rare resets) match the models | 5009 checks | PASS |
| 11 | boundary_and_errors | first/last word valid; misaligned, out-of-range, write -> `resp_err`, no memory read | 43 checks | PASS |
| 12 | conflict_100_1124_104 | 100 -> 1124 -> 100: MISS MISS MISS; then 100 -> 104: MISS HIT | 28 checks, 4 req: 1 hit / 3 miss / 3 mem reads | PASS |

Test 12 checks the brief's example explicitly: address 100 = block 6, index 6, tag 0 and address 1124 = block 70, index 6, tag 1,
both mapping to line 6. After each access it reads the tag and valid RAMs of line 6 (tag 0, then 1, then 0, valid each time), requires
three memory reads for the three misses, none for the hit on 104 (same 16-byte block as 100), and compares the stored line with
the main-memory block.

## Unit tests (one testbench per module, `testbench/tb_<module>.v`)

| Testbench | Module | What it checks | Checks | Result |
|---|---|---|---|---|
| `tb_address_decoder` | `address_decoder` | bit slicing for 20,000 random addresses in two geometries, corner cases | 40005 | PASS |
| `tb_tag_comparator` | `tag_comparator` | 3-bit exhaustive, each single-bit difference, corner and random 22-bit cases | 5091 | PASS |
| `tb_hit_miss_unit` | `hit_miss_unit` | full truth table; invalid line misses even when the tags match | 8 | PASS |
| `tb_storage` | data, tag, valid RAMs | reset clears valid bits, tag/data read and write, read hold, byte mask | 74 | PASS |

Check counts are printed by each testbench (`make test`). Breaking `hit_miss_unit` (ignoring the valid bit) or `tag_comparator` (dropping a tag bit)
makes the matching unit test fail; ignoring only tag bit 21 is caught by the unit test but not by the system tests, because the 64 KB memory model
never produces an address with bit 31 set.

## Regression (`make regression`)
16 runs, all passing at the time of writing (`regression_summary.txt`): unit tests; system testbench at memory latency 1, 2, 4, 8, 16;
memory back-pressure (`mem_req_ready` held low for 1 or 3 extra cycles) at latency 1 and 4; random seeds 2, 3, 4. With back-pressure,
latency checks use `miss = LAT + 7 + ACCEPT_DELAY`.

## Does the testbench catch bugs?
- Earlier work (IEEE report, Section IV) injected 13 bugs one at a time into copies of the RTL: 12 were caught and the 13th is
  behaviourally equivalent to the original. That experiment was not re-run for the 12-test suite.
- For the checks added later, three RTL copies were broken and simulated: dropping the valid check, comparing 21 of 22 tag bits,
  and removing the request-hold in `main_memory_interface`. All three were reported as failures (the first two failed T12, among others; the third
  failed protocol rule P1 at the first miss, then timed out). `make test` and `make regression` returned a non-zero exit code
  with the valid check removed. These were manual checks; the broken copies were not kept.

## Waveforms
`make wave TEST=<name> [LAT=4]` writes `simulation/waveforms/<name>_lat<LAT>.vcd` with complete timing (nothing trimmed, no change to the
simulation) from `$dumpvars(0, tb_cache_controller)`: clock and reset, CPU request/address/response, hit and miss, FSM state, cache
index and tag, memory request/ready/data, refill enable. `make wave` with no argument lists the test names; `TEST=all` dumps the whole
suite. Open with `gtkwave simulation/waveforms/<file>.vcd`. VCD files are generated, not tracked in git.

Observed in `direct_mapped_conflict_lat4.vcd` and the miss/hit diagram `docs/images/wave_cold_miss.png` and `docs/images/wave_repeated.png`: a miss runs
LOOKUP -> MISS_REQ -> WAIT_MEM (LAT+4 cycles) -> REFILL -> COMPLETE with one `mem_req_valid` request and one `mem_resp_valid` pulse;
a following hit runs LOOKUP -> COMPLETE in 2 cycles with no memory activity.

## Known limitations
- Read-only: write requests return `resp_err` (tested), so write policy is not verified.
- One outstanding request; the testbench cannot test back-to-back pipelined requests because the interface does not support them.
- The memory model never returns errors, and `mem_resp_valid` always follows an accepted request.
- Traces are synthetic; no real program was run.
- No formal verification and no SystemVerilog assertions; checks are procedural in the testbench.
