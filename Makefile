# Direct-mapped cache controller. Run `make help`.
TEST ?=
LAT  ?= 4
PY   ?= .venv/bin/python
.PHONY: help all sim waves-all compile test regression wave synth perf diagrams waveforms report clean

help:
	@echo "Simple commands:"
	@echo "  make sim                  run ALL tests and write a waveform (VCD) for every test"
	@echo "  make test                 run all tests only (quick)"
	@echo "  make wave TEST=conflict   waveform for one test (make wave lists the names)"
	@echo "Core flow (Icarus Verilog + Yosys):"
	@echo "  make compile              compile RTL and testbenches, Yosys elaboration check"
	@echo "  make test [LAT=4]         unit tests + 12-test system testbench at one memory latency"
	@echo "  make regression           latency 1/2/4/8/16, back-pressure, extra seeds; summary in simulation/logs/"
	@echo "  make wave TEST=<name> [LAT=4]   VCD for one test -> simulation/waveforms/ (make wave lists the test names)"
	@echo "  make synth                Yosys synthesis (generic + iCE40) -> synth/"
	@echo "  make clean                remove generated logs, VCDs and binaries"
	@echo "Analysis and report (needs .venv with matplotlib and pymupdf):"
	@echo "  make perf                 workload traces -> docs/perf_results.md, docs/performance.csv, docs/images/"
	@echo "  make diagrams             diagrams/*.tex -> SVG/PNG and report figures"
	@echo "  make waveforms            run tests and draw waveform figures -> docs/images/, report/figures/"
	@echo "  make report               rebuild the IEEE report PDF (needs pdflatex)"
	@echo "  make all                  compile, regression, perf, synth, diagrams, waveforms, report"

all: compile regression perf synth diagrams waveforms report

sim: test waves-all
	@echo ""; echo "ALL TESTS PASSED. Waveforms are in simulation/waveforms/ (open one with: gtkwave simulation/waveforms/<file>.vcd)"
waves-all:
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12; do scripts/run_wave.sh $$i $(LAT) | grep -E "^waveform|FAILED" || exit 1; done

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
perf:
	$(PY) -I scripts/analyze_results.py
diagrams:
	$(PY) -I scripts/make_diagrams.py
waveforms:
	$(PY) -I scripts/make_waveforms.py
report:
	cp docs/images/hit_miss_rate.png docs/images/amat_vs_latency.png report/figures/
	cd report && pdflatex -interaction=nonstopmode main.tex >/dev/null && pdflatex -interaction=nonstopmode main.tex >/dev/null && pdflatex -interaction=nonstopmode main.tex >/dev/null && cp main.pdf IEEE_Report_Final.pdf
clean:
	rm -f simulation/logs/*.vvp simulation/logs/reg_*.log simulation/logs/wave_*.log simulation/logs/perf_*.log simulation/logs/unit_*.log
	rm -f simulation/waveforms/*.vcd
