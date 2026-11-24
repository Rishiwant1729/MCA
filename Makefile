# Direct-mapped cache controller. Run `make help`.
.PHONY: help all smoke sim perf synth waves portal verify-portal report lint clean
help:
	@echo "make all    - lint, sim, perf, synth, waves (the full reproducible flow)"
	@echo "make waves  - render docs/diagrams/waveform_miss_then_hits.png from a fresh simulation"
	@echo "make portal - start the web portal at http://127.0.0.1:8765/ (run sims, view waveforms)"
	@echo "make verify-portal - prove portal waveforms come from real runs; test backend safety"
	@echo "make report - regenerate waveform figures from real runs and build the IEEE PDF (needs pdflatex + IEEEtran)"
	@echo "make smoke  - toolchain smoke test"
	@echo "make sim    - unit tests + full testbench at LAT=1,2,4,8,16 (nonzero exit on failure)"
	@echo "make perf   - run workloads, write CSVs and plots to results/performance/"
	@echo "make lint   - iverilog -Wall and Yosys elaboration check of rtl/"
	@echo "make clean  - remove generated simulation files"
all: lint sim perf synth waves verify-portal
waves:
	iverilog -g2012 -I sim -Ptb_integration.LAT=4 -o results/simulation_logs/tb_integration.vvp rtl/*.v sim/main_memory_model.v sim/reference_memory.v sim/tb_integration.v
	vvp -n results/simulation_logs/tb_integration.vvp > results/simulation_logs/integration_lat4.log
	.venv/bin/python -I scripts/plot_waveform.py results/waveforms/phase4_lat4.vcd docs/diagrams/waveform_miss_then_hits.png
	@for d in fsm block_diagram; do dot -Tpng -Gdpi=130 docs/diagrams/$$d.dot -o docs/diagrams/$$d.png; done
portal:
	python3 extras/portal/server.py
verify-portal:
	python3 extras/portal/verify_portal.py
report:
	.venv/bin/python -I scripts/make_report_figures.py
	cd report && pdflatex -interaction=nonstopmode main.tex >/dev/null && pdflatex -interaction=nonstopmode main.tex >/dev/null && pdflatex -interaction=nonstopmode main.tex >/dev/null && cp main.pdf Direct_Mapped_Cache_Controller_IEEE_Report.pdf
smoke:
	iverilog -g2012 -o results/simulation_logs/smoke.vvp sim/smoke_test.v && vvp results/simulation_logs/smoke.vvp
sim:
	scripts/run_simulation.sh
perf:
	.venv/bin/python -I scripts/analyze_results.py
synth:
	scripts/run_synthesis.sh
lint:
	iverilog -g2012 -Wall -o /dev/null rtl/*.v
	yosys -q -p "read_verilog -sv rtl/*.v; hierarchy -top cache_controller; proc; check -assert"
clean:
	rm -f results/simulation_logs/*.vvp results/waveforms/*.vcd
	rm -rf results/portal_runs
