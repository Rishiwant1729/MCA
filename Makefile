# Direct-mapped cache controller. Run `make help`.
TEST ?=
LAT  ?= 4
.PHONY: help all compile test regression wave synth clean smoke sim perf lint waves portal verify-portal report

help:
	@echo "Core flow (Icarus Verilog + Yosys):"
	@echo "  make compile              compile RTL and testbenches, Yosys elaboration check"
	@echo "  make test [LAT=4]         unit tests + 12-test system testbench at one memory latency"
	@echo "  make regression           latency 1/2/4/8/16, memory back-pressure, extra seeds; summary in results/simulation_logs/"
	@echo "  make wave TEST=<name> [LAT=4]   VCD for one test -> results/waveforms/ (make wave lists the test names)"
	@echo "  make synth                Yosys synthesis (generic + iCE40) -> results/synthesis/"
	@echo "  make clean                remove generated simulation files (logs, VCDs, binaries)"
	@echo "Analysis and extras:"
	@echo "  make perf                 workload traces -> hit rate / AMAT CSVs and plots (needs .venv with matplotlib)"
	@echo "  make waves                regenerate docs/diagrams/ timing diagram and block/FSM diagrams"
	@echo "  make lint | smoke | sim   lint only; toolchain check; the original latency sweep (superseded by regression)"
	@echo "  make all                  compile, regression, perf, synth, waves"
	@echo "  make portal | verify-portal   optional browser viewer in extras/portal/"
	@echo "  make report               rebuild the IEEE report PDF (needs pdflatex)"

all: compile regression perf synth waves

compile:
	scripts/compile.sh
test:
	scripts/run_tests.sh $(LAT)
regression:
	scripts/regression.sh
wave:
	scripts/run_wave.sh "$(TEST)" $(LAT)
synth:
	scripts/run_synthesis.sh
clean:
	rm -f results/simulation_logs/*.vvp results/simulation_logs/reg_*.log results/simulation_logs/wave_*.log
	rm -f results/waveforms/*.vcd
	rm -rf results/portal_runs

lint:
	iverilog -g2012 -Wall -o /dev/null rtl/*.v
	yosys -q -p "read_verilog -sv rtl/*.v; hierarchy -top cache_controller; proc; check -assert"
smoke:
	iverilog -g2012 -o results/simulation_logs/smoke.vvp sim/smoke_test.v && vvp results/simulation_logs/smoke.vvp
sim:
	scripts/run_simulation.sh
perf:
	.venv/bin/python -I scripts/analyze_results.py
waves:
	iverilog -g2012 -I sim -Ptb_integration.LAT=4 -o results/simulation_logs/tb_integration.vvp rtl/*.v sim/main_memory_model.v sim/reference_memory.v sim/tb_integration.v
	vvp -n results/simulation_logs/tb_integration.vvp > results/simulation_logs/integration_lat4.log
	.venv/bin/python -I scripts/plot_waveform.py results/waveforms/phase4_lat4.vcd docs/diagrams/waveform_miss_then_hits.png
	@for d in fsm block_diagram; do dot -Tpng -Gdpi=130 docs/diagrams/$$d.dot -o docs/diagrams/$$d.png; done
report:
	.venv/bin/python -I scripts/make_report_figures.py
	cd report && pdflatex -interaction=nonstopmode main.tex >/dev/null && pdflatex -interaction=nonstopmode main.tex >/dev/null && pdflatex -interaction=nonstopmode main.tex >/dev/null && cp main.pdf Direct_Mapped_Cache_Controller_IEEE_Report.pdf
portal:
	python3 extras/portal/server.py
verify-portal:
	python3 extras/portal/verify_portal.py
