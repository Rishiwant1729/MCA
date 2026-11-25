# Team workflow

Five members, each owning a part of the design, its tests and its documentation. Everyone runs `make test` before pushing.

## Who owns what

| Member | Owns (RTL) | Owns (tests and scripts) | Owns (docs and extras) |
|---|---|---|---|
| **Rishiwant Kumar Maurya** (lead) | `rtl/cache_controller.v` | `Makefile`, `scripts/common.sh`, `compile.sh`, `run_tests.sh`, `regression.sh`, `run_wave.sh` | `README.md`, `docs/architecture.md`, `docs/fsm_design.md`, `docs/project_guide.html` |
| **Aditya Shankar** | `rtl/address_decoder.v`, `rtl/cache_valid_ram.v`, `rtl/cache_tag_ram.v`, `rtl/cache_data_ram.v` | `testbench/tb_address_decoder.v`, `testbench/tb_storage.v` | prototype demo video |
| **Animesh Kumar Rai** | `rtl/tag_comparator.v`, `rtl/hit_miss_unit.v`, `rtl/main_memory_interface.v` | `testbench/tb_tag_comparator.v`, `testbench/tb_hit_miss_unit.v`, `testbench/main_memory_model.v`, `testbench/mem_init.vh` | memory-interface notes in `docs/architecture.md` |
| **Drishti Jha** | - | `testbench/tb_cache_controller.v`, `testbench/reference_memory.v`, `scripts/make_waveforms.py` | `docs/verification.md`, `docs/images/wave_*.png`, `simulation/logs/` evidence |
| **Supreet** | - | `testbench/tb_perf.v`, `testbench/test_vectors/`, `scripts/analyze_results.py`, `scripts/run_synthesis.sh`, `scripts/synth_summary.py`, `synth/*.ys` | `docs/perf_results.md`, `docs/synthesis.md`, `docs/literature_review.md`, `diagrams/`, `report/` |

Shared: nobody changes a file owned by someone else without telling the owner. Interfaces (module ports) are fixed in `docs/architecture.md`.

## How the pieces connect

1. Aditya's storage modules and Animesh's hit logic are used by Rishiwant's `cache_controller`.
2. Animesh's memory model and Drishti's reference model feed Drishti's system testbench.
3. Drishti's VCD files are drawn by `make waveforms`; Supreet's synthesis, performance and diagrams go into Supreet's report.
4. Rishiwant integrates everything and keeps `make all` working.

## Git workflow

```bash
git pull --rebase                  # get the others' work first
make test                          # unit tests + 12 system tests must pass
git add <your files>
git commit -m "feat(storage): short description"
git push
```

Small commits with clear messages (`feat(...)`, `test(...)`, `docs: ...`). Do not rewrite shared history unless the whole team agrees.
