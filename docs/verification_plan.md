# Verification Plan and Results (milestone 1: read-only cache)

Run everything: `make sim` (unit tests + full testbench at memory latency 1, 2, 4, 8, 16; nonzero exit on any failure).
Logs: `results/simulation_logs/`. Waveform evidence (LAT=4, tests T1–T9): `results/waveforms/tb_cache_lat4.vcd`
(signal `test_no` shows which test is running).

## Checking layers
1. **Monitor + models** (`sim/tb_cache_controller.v`): at every accepted request it predicts the data from
   `reference_memory` (independent word-array golden model) and hit/miss from a behavioral valid/tag model written
   separately from the RTL. It checks every response and the protocol: one response per request, none spurious,
   none while idle, a miss response never before memory data, no request accepted while busy.
2. **Directed checks**: explicit hit/miss patterns, latency (hit 2, miss LAT+7), memory read counts and block
   alignment, and white-box checks of the valid/tag/data arrays.
3. **Counter cross-check** after every test: DUT statistics must equal the testbench model's counts, memory-wait cycles
   must equal misses × (LAT+4), and `stat_mem_reads` must equal the reads seen on the memory bus.

Every test starts with a reset so tests are independent. The random test uses a fixed seed (`SEED`, default 1).

## Tests
| # | Name | Expected behavior |
|---|---|---|
| 1 | cold_miss | invalid line → miss; 1 block-aligned memory read; valid/tag/data installed; correct data |
| 2 | repeated_access | miss then hits; 1 memory read |
| 3 | same_block_accesses | 4 words of one block: 1 miss + 3 hits; no extra refill |
| 4 | direct_mapped_conflict | addresses 0 and 1024: same index, different tag; alternating accesses always miss |
| 5 | different_cache_lines | all 64 lines filled without evicting each other; second pass all hits |
| 6 | sequential_access | 256 sequential words: 64 misses, 192 hits; second pass all hits |
| 7 | reset | valid bits and counters clear; stale tag + data present but never hit; reset during a miss leaves the controller idle with no valid bit set |
| 8 | memory_latency | miss takes LAT+7 cycles, memory wait LAT+4, hit takes 2 |
| 9 | request_handshake | 40 back-to-back requests held while busy: each accepted once, in order; a request withdrawn while busy is never accepted; address changes after accept are ignored |
| 10 | randomized | 5000 seeded random requests (local/wide/conflict mix, idle gaps, rare resets, ~1% misaligned) all match the models |
| 11 | boundary_and_errors | first/last valid word; misaligned, out-of-range and write requests give `resp_err`, no memory read |

Result at the time of writing: all 11 tests pass at LAT = 1, 2, 4, 8, 16.

## Does the testbench catch bugs? (mutation check)
Bugs were injected into copies of the RTL and the testbench was run on each. All were caught (nonzero exit):
ignoring valid bits, ignoring the tag LSB, wrong word select, refill writing the wrong line (data, tag or valid
array), valid bits not cleared on reset, miss returning stale data, wrong hit counter, not waiting for memory data,
tag RAM not written, unaligned memory address. An initial version missed "refill writes the wrong line" because the
driver kept the address stable after accepting; the driver now changes the address after accept and T9 reads the
stream back.

One mutant survives by design: ignoring the tag's top bit (address bit 31). With a 64 KB memory range, valid
addresses never have bit 31 set, so the mutant is behaviorally equivalent in this configuration.

## Portal verification
`make verify-portal` (see `portal.md`): VCD provenance (Icarus header, sha256), indexed values vs an independent re-parse, VCD counters vs the
simulator's printed counters, reconstructed cache lines vs the memory image, byte-identical VCD download, and rejection of unapproved scenarios,
latencies, malformed/oversized requests and path traversal.

## Not covered
- Memory back-pressure (`mem_req_ready` low): the memory model is always ready when idle.
- Writes and byte enables (milestone 2); the controller reports `resp_err` for write requests.
- Non-default cache geometries are unit-tested only for the address decoder.
